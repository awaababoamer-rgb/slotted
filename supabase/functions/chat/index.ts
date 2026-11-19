// Slotted's chat assistant: a small server function that passes the student's
// messages to Google Gemini. It runs on Supabase (an "Edge Function"), so the
// Gemini key stays on the server and never reaches the browser.
//
// The bot can't read the database itself. It asks the WEBSITE to run tools
// (search courses, check what fits your week...) and the website sends the
// answers back in the next request. Changes to the schedule are only
// PROPOSED; the student confirms them with a button.
//
// Secrets (Supabase dashboard -> Edge Functions -> Secrets):
//   GEMINI_API_KEY   required
//   GEMINI_MODEL     optional, defaults to gemini-3.5-flash

const MODEL = Deno.env.get("GEMINI_MODEL") || "gemini-3.5-flash";
/** Tried in order when the main model is busy, slow or rate-limited. */
const FALLBACK_MODELS = ["gemini-3.1-flash-lite", "gemini-3-flash-preview"];
/** Give up on one model after this long and try the next (the site waits for the whole thing). */
const TIMEOUT_MS = 20_000;
const MAX_TURNS = 30; // messages + tool results kept in one conversation
const MAX_CHARS = 40_000; // total size of one request, to protect the free quota
const MAX_CONTEXT_CHARS = 8_000;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SYSTEM_PROMPT = `You are the assistant inside Slotted, a course schedule planner made by students for Western University students. Slotted is not affiliated with Western.

Help the student plan their timetable: find courses, compare them, explain conflicts, and suggest changes.
- Use the tools for every course fact. Never invent course codes, titles, times, instructors or ratings. If a tool finds nothing, say so.
- To suggest adding or removing a course, call propose_add_course or propose_remove_course. The student sees a button and decides; never say a change is done.
- Slotted does not check prerequisites, breadth requirements or program rules. When it matters, tell the student to confirm with the Academic Calendar or an academic counsellor.
- Never ask for passwords, student numbers or other personal information.
- Don't write assignments, essays or exam answers; politely say that's outside what you do.
- Keep answers short (under about 120 words), friendly and in plain language. Use full course codes like "COMPSCI 2210A". Times use a 12-hour clock.
- Some courses have no known meeting times yet; say that instead of guessing.`;

const TOOLS = [{
  functionDeclarations: [
    {
      name: "search_courses",
      description: "Search the course catalog by code or words in the title. Returns up to 10 courses with term, whether times are known, and rating.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: 'e.g. "COMPSCI 2210", "psychology", "data"' },
          term: { type: "string", enum: ["first_term", "second_term", "any"], description: "Fall = first_term, Winter = second_term" },
        },
        required: ["query"],
      },
    },
    {
      name: "get_course",
      description: "Full details of one course: every section with days, times, rooms, instructors and whether it is full, plus review averages.",
      parameters: {
        type: "object",
        properties: { code: { type: "string", description: 'Exact code, e.g. "COMPSCI 2210A"' } },
        required: ["code"],
      },
    },
    {
      name: "find_fitting_courses",
      description: "Courses with sections that fit around the student's current week with no conflicts, ranked by how well they fit and by reviews. Only courses with known times.",
      parameters: {
        type: "object",
        properties: {
          term: { type: "string", enum: ["first_term", "second_term"] },
          subject: { type: "string", description: 'Optional subject code, e.g. "PSYCHOL", "COMPSCI"' },
          level: { type: "string", enum: ["1000", "2000", "3000", "4000"] },
          prefer_lighter: { type: "boolean", description: "Favour lighter workload / easier courses" },
          free_day: { type: "string", enum: ["Mon", "Tue", "Wed", "Thu", "Fri"], description: "Only courses with no class on this day" },
          not_before: { type: "string", description: 'Only courses whose classes start at or after this time, "HH:MM" 24-hour' },
        },
        required: ["term"],
      },
    },
    {
      name: "propose_add_course",
      description: "Suggest adding a course to the student's week. They confirm with a button.",
      parameters: {
        type: "object",
        properties: { code: { type: "string" }, reason: { type: "string", description: "One short sentence" } },
        required: ["code", "reason"],
      },
    },
    {
      name: "propose_remove_course",
      description: "Suggest removing a course from the student's week. They confirm with a button.",
      parameters: {
        type: "object",
        properties: { code: { type: "string" }, reason: { type: "string", description: "One short sentence" } },
        required: ["code", "reason"],
      },
    },
  ],
}];

function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

/** Only signed-in Slotted users may use the bot (and the free Gemini quota). */
async function signedInUser(req: Request): Promise<string | null> {
  const auth = req.headers.get("Authorization");
  const url = Deno.env.get("SUPABASE_URL");
  const apikey = req.headers.get("apikey") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  if (!auth || !url) return null;
  const res = await fetch(`${url}/auth/v1/user`, { headers: { Authorization: auth, apikey } });
  if (!res.ok) return null;
  const user = await res.json();
  return typeof user?.id === "string" ? user.id : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return reply({ error: "Use POST" }, 405);

  if (!(await signedInUser(req))) return reply({ error: "Please sign in to use the assistant." }, 401);

  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) return reply({ error: "The assistant isn't set up yet (missing GEMINI_API_KEY)." }, 500);

  let body: { contents?: unknown; context?: unknown };
  try {
    body = await req.json();
  } catch {
    return reply({ error: "Bad request" }, 400);
  }
  const contents = Array.isArray(body.contents) ? body.contents.slice(-MAX_TURNS) : [];
  const context = typeof body.context === "string" ? body.context.slice(0, MAX_CONTEXT_CHARS) : "";
  if (contents.length === 0) return reply({ error: "No message" }, 400);
  if (JSON.stringify(contents).length > MAX_CHARS) {
    return reply({ error: "This conversation is too long. Start a new chat." }, 413);
  }

  const request = JSON.stringify({
    systemInstruction: { parts: [{ text: `${SYSTEM_PROMPT}\n\nAbout the student right now:\n${context}` }] },
    contents,
    tools: TOOLS,
    generationConfig: { temperature: 0.4, maxOutputTokens: 4096 },
  });

  // New Gemini models are sometimes overloaded or slow. Try the main model, then backups.
  // Only "busy" kinds of failure move on to the next model; a bad request won't get better.
  const problems: string[] = [];
  for (const model of [MODEL, ...FALLBACK_MODELS.filter((m) => m !== MODEL)]) {
    let gemini: Response;
    try {
      gemini = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: request,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      const reason = (e as Error).name === "TimeoutError" ? "timed out" : "network error";
      console.error("Gemini", model, reason, String(e).slice(0, 200));
      problems.push(`${model} ${reason}`);
      continue;
    }
    if (gemini.ok) {
      const data = await gemini.json();
      const content = data?.candidates?.[0]?.content;
      if (content?.parts?.length) return reply({ content, model });
      const why = data?.candidates?.[0]?.finishReason ?? data?.promptFeedback?.blockReason ?? "empty answer";
      console.error("Gemini", model, "no content:", why);
      return reply({ error: `The assistant couldn't answer that (${why}). Try rephrasing.` }, 502);
    }
    const text = (await gemini.text()).slice(0, 500);
    console.error("Gemini", model, gemini.status, text);
    problems.push(`${model} ${gemini.status}`);
    // 404 = Google retired the model; the backups may still work.
    if (![404, 429, 500, 503, 504].includes(gemini.status)) {
      // e.g. 400 (bad request) or 403 (key/region problem): show the reason.
      const message = (() => { try { return JSON.parse(text)?.error?.message ?? ""; } catch { return ""; } })();
      return reply({ error: `The assistant couldn't answer right now (Gemini ${gemini.status}${message ? `: ${message.slice(0, 160)}` : ""}).` }, 502);
    }
  }
  const allLimited = problems.every((p) => p.endsWith(" 429"));
  return reply({
    error: allLimited
      ? "The assistant is busy (free limit reached). Try again in a minute."
      : `Gemini is busy right now. Try again in a moment. (${problems.join(", ")})`,
  }, 503);
});
