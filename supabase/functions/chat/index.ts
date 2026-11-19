// Slotted's chat assistant: a small server function that passes the student's
// messages to an AI model. It runs on Supabase (an "Edge Function"), so the AI
// keys stay on the server and never reach the browser.
//
// The bot can't read the database itself. It asks the WEBSITE to run tools
// (search courses, check what fits your week...) and the website sends the
// answers back in the next request. Changes to the schedule are only
// PROPOSED; the student confirms them with a button.
//
// Models are tried in order until one answers: Groq first (fast: under 1 s per
// step), then Google Gemini as a backup. The website always talks in Gemini's
// message format; this file translates to and from Groq's format.
//
// Secrets (Supabase dashboard -> Edge Functions -> Secrets):
//   GROQ_API_KEY     main provider (free plan: 1,000 requests a day per model)
//   GEMINI_API_KEY   backup provider (free plan: 500 a day for the Flash Lite models)
//   GROQ_MODEL, GEMINI_MODEL   optional: put a different model first

const GROQ_MODELS = [Deno.env.get("GROQ_MODEL") || "openai/gpt-oss-120b", "qwen/qwen3.8-27b"];
const GEMINI_MODELS = [Deno.env.get("GEMINI_MODEL") || "gemini-3.1-flash-lite", "gemini-3.5-flash-lite"];
/** Give up on one model after this long and try the next (the site waits for the whole thing). */
const TIMEOUT_MS = 12_000;
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
- Keep answers short (under about 120 words), friendly and in plain language. Use full course codes like "COMPSCI 2210A". Times use a 12-hour clock. Never use tables; use a short bulleted list (at most 5 courses) instead.
- Some courses have no known meeting times yet; say that instead of guessing.
- Terms: Fall runs September to December, Winter runs January to April. Use the term the student names; if they don't name one, use the term they are looking at (see "About the student"). Always state each course's term exactly as the tools' "term" field gives it; never guess it from the course code.
- Ratings come only from the tools (top_rated_courses, get_course, search_courses, find_fitting_courses). Very few courses have reviews so far. For "good rating" or "best reviewed" questions, call top_rated_courses. If it returns nothing, say that no courses matching the request have reviews yet; never describe a course as well rated unless a tool returned its rating.`;

const TOOLS = [{
  functionDeclarations: [
    {
      name: "search_courses",
      description: "Search the course catalog by code or words in the title. Returns up to 10 courses with term, whether times are known, and rating.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: 'e.g. "COMPSCI 2210", "psychology", "data"' },
          term: { type: "string", enum: ["fall", "winter", "any"], description: "fall = September to December, winter = January to April" },
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
          term: { type: "string", enum: ["fall", "winter"], description: "fall = September to December, winter = January to April" },
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
      name: "top_rated_courses",
      description: "Courses with student reviews, best rated first (averages are adjusted so one review can't beat many). Says whether each fits the student's week. Use for any question about good ratings, best or easiest courses.",
      parameters: {
        type: "object",
        properties: {
          term: { type: "string", enum: ["fall", "winter", "any"], description: "fall = September to December, winter = January to April" },
          subject: { type: "string", description: 'Optional subject code, e.g. "PSYCHOL"' },
          level: { type: "string", enum: ["1000", "2000", "3000", "4000"] },
          only_fitting: { type: "boolean", description: "Only courses with sections that fit the student's week" },
        },
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

// ---------- Message formats ----------
// Gemini format (what the website sends): [{role: "user"|"model", parts: [{text} | {functionCall} | {functionResponse}]}]
// Groq uses the OpenAI format: [{role: "system"|"user"|"assistant"|"tool", content, tool_calls?, tool_call_id?}]

interface Part {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  functionCall?: { name: string; args?: Record<string, unknown>; id?: string };
  functionResponse?: { name: string; response: unknown; id?: string };
}
interface Content { role: "user" | "model"; parts: Part[] }

type Attempt = { content: Content } | { retry: boolean; problem: string; message?: string };

function toOpenAI(contents: Content[], system: string) {
  const messages: Record<string, unknown>[] = [{ role: "system", content: system }];
  let counter = 0;
  const open: { id: string; name: string }[] = []; // tool calls still waiting for their result
  for (const turn of contents) {
    const parts = Array.isArray(turn?.parts) ? turn.parts : [];
    const text = parts.filter((p) => typeof p.text === "string" && !p.thought).map((p) => p.text).join("");
    if (turn.role === "model") {
      const calls = parts.filter((p) => p.functionCall).map((p) => {
        const id = p.functionCall!.id || `call_${counter++}`;
        open.push({ id, name: p.functionCall!.name });
        return { id, type: "function", function: { name: p.functionCall!.name, arguments: JSON.stringify(p.functionCall!.args ?? {}) } };
      });
      messages.push({ role: "assistant", content: text || null, ...(calls.length ? { tool_calls: calls } : {}) });
    } else {
      for (const p of parts.filter((q) => q.functionResponse)) {
        const fr = p.functionResponse!;
        const match = open.find((o) => (fr.id ? o.id === fr.id : o.name === fr.name));
        if (match) open.splice(open.indexOf(match), 1);
        messages.push({ role: "tool", tool_call_id: fr.id || match?.id || `call_${counter++}`, content: JSON.stringify(fr.response ?? {}) });
      }
      if (text) messages.push({ role: "user", content: text });
    }
  }
  return messages;
}

function fromOpenAI(message: { content?: string | null; tool_calls?: { id: string; function: { name: string; arguments: string } }[] }): Content {
  const parts: Part[] = [];
  const text = (message.content ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  if (text) parts.push({ text });
  for (const call of message.tool_calls ?? []) {
    let args: Record<string, unknown> = {};
    try { args = JSON.parse(call.function.arguments || "{}"); } catch { /* keep empty */ }
    parts.push({ functionCall: { name: call.function.name, args, id: call.id } });
  }
  return { role: "model", parts };
}

const OPENAI_TOOLS = TOOLS[0].functionDeclarations.map((f) => ({ type: "function", function: f }));

async function askGroq(model: string, key: string, contents: Content[], system: string): Promise<Attempt> {
  let res: Response;
  try {
    res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        messages: toOpenAI(contents, system),
        tools: OPENAI_TOOLS,
        temperature: 0.4,
        max_tokens: 2048,
        // gpt-oss "thinks" before answering; low keeps it fast and leaves room for the answer.
        ...(model.startsWith("openai/") ? { reasoning_effort: "low" } : {}),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    return { retry: true, problem: `${model} ${(e as Error).name === "TimeoutError" ? "timed out" : "network error"}` };
  }
  if (!res.ok) {
    console.error("Groq", model, res.status, (await res.text()).slice(0, 500));
    return { retry: true, problem: `${model} ${res.status}` }; // any Groq problem: try the next model
  }
  const data = await res.json();
  const content = fromOpenAI(data?.choices?.[0]?.message ?? {});
  if (content.parts.length) return { content };
  return { retry: true, problem: `${model} empty answer` };
}

async function askGemini(model: string, key: string, contents: Content[], system: string): Promise<Attempt> {
  // Tool calls made by a Groq model carry no Gemini "thought signature"; this marker tells Gemini to accept them.
  const prepared = contents.map((turn) => ({
    ...turn,
    parts: (turn.parts ?? []).map((p) =>
      p.functionCall && !p.thoughtSignature ? { ...p, thoughtSignature: "skip_thought_signature_validator" } : p),
  }));
  let res: Response;
  try {
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: prepared,
        tools: TOOLS,
        generationConfig: { temperature: 0.4, maxOutputTokens: 4096 },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    return { retry: true, problem: `${model} ${(e as Error).name === "TimeoutError" ? "timed out" : "network error"}` };
  }
  if (res.ok) {
    const data = await res.json();
    const content = data?.candidates?.[0]?.content;
    if (content?.parts?.length) return { content };
    const why = data?.candidates?.[0]?.finishReason ?? data?.promptFeedback?.blockReason ?? "empty answer";
    return { retry: false, problem: `${model} ${why}`, message: `The assistant couldn't answer that (${why}). Try rephrasing.` };
  }
  const text = (await res.text()).slice(0, 500);
  console.error("Gemini", model, res.status, text);
  // 404 = Google retired the model; 429/5xx = busy. Those may work on the next model.
  if ([404, 429, 500, 503, 504].includes(res.status)) return { retry: true, problem: `${model} ${res.status}` };
  const message = (() => { try { return JSON.parse(text)?.error?.message ?? ""; } catch { return ""; } })();
  return { retry: false, problem: `${model} ${res.status}`, message: `The assistant couldn't answer right now (Gemini ${res.status}${message ? `: ${message.slice(0, 160)}` : ""}).` };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return reply({ error: "Use POST" }, 405);

  if (!(await signedInUser(req))) return reply({ error: "Please sign in to use the assistant." }, 401);

  const groqKey = Deno.env.get("GROQ_API_KEY");
  const geminiKey = Deno.env.get("GEMINI_API_KEY");
  if (!groqKey && !geminiKey) return reply({ error: "The assistant isn't set up yet (no AI key)." }, 500);

  let body: { contents?: unknown; context?: unknown };
  try {
    body = await req.json();
  } catch {
    return reply({ error: "Bad request" }, 400);
  }
  const contents = (Array.isArray(body.contents) ? body.contents.slice(-MAX_TURNS) : []) as Content[];
  const context = typeof body.context === "string" ? body.context.slice(0, MAX_CONTEXT_CHARS) : "";
  if (contents.length === 0) return reply({ error: "No message" }, 400);
  if (JSON.stringify(contents).length > MAX_CHARS) {
    return reply({ error: "This conversation is too long. Start a new chat." }, 413);
  }
  const system = `${SYSTEM_PROMPT}\n\nAbout the student right now:\n${context}`;

  type Try = [string, () => Promise<Attempt>];
  const attempts: Try[] = [
    ...(groqKey ? GROQ_MODELS.map((m): Try => [m, () => askGroq(m, groqKey, contents, system)]) : []),
    ...(geminiKey ? GEMINI_MODELS.map((m): Try => [m, () => askGemini(m, geminiKey, contents, system)]) : []),
  ];
  const problems: string[] = [];
  for (const [model, attempt] of attempts) {
    const result = await attempt();
    if ("content" in result) return reply({ content: result.content, model });
    console.error("AI attempt failed:", result.problem);
    problems.push(result.problem);
    if (!result.retry) return reply({ error: result.message ?? "The assistant couldn't answer right now." }, 502);
  }
  const allLimited = problems.every((p) => p.endsWith(" 429"));
  return reply({
    error: allLimited
      ? "The assistant is busy (free limit reached). Try again in a minute."
      : `The AI services are busy right now. Try again in a moment. (${problems.join(", ")})`,
  }, 503);
});
