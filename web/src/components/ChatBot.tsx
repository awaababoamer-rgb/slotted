import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Course } from "@slotted/engine";
import { allCourseRatings, type Ratings } from "../data/reviews";
import { requireSupabase } from "../data/supabase";
import { describeStudent, runTool, type Proposal, type ToolEnv } from "../lib/chatTools";
import type { ScheduleApi } from "../state/useSchedule";

// Gemini's message format: a list of turns, each with "parts" (text or tool calls/results).
interface Part {
  text?: string;
  thought?: boolean;
  functionCall?: { name: string; args?: Record<string, unknown>; id?: string };
  functionResponse?: { name: string; response: unknown; id?: string };
  [extra: string]: unknown;
}
interface Content { role: "user" | "model"; parts: Part[] }

interface Message {
  from: "me" | "bot";
  text: string;
  proposals?: Proposal[];
  error?: boolean;
}

const SUGGESTIONS = [
  "What could I add that fits my week?",
  "Find me an easy elective with no Friday classes",
  "Explain my conflicts",
  "Compare COMPSCI 2210A and COMPSCI 2211A",
];

/** How many tool rounds one question may take (each is a request to Gemini). */
const MAX_TOOL_ROUNDS = 5;

async function askServer(contents: Content[], context: string): Promise<Content> {
  const { data, error } = await requireSupabase().functions.invoke("chat", { body: { contents, context } });
  if (error) {
    // The function's own message (e.g. "The assistant is busy") is in the response body.
    let message = error.name === "FunctionsFetchError"
      ? "Couldn't reach the assistant. Check your internet connection and try again."
      : error.name === "FunctionsRelayError"
        ? "The assistant's server didn't respond. Try again in a moment."
        : "The assistant couldn't answer right now.";
    try {
      const body = await (error as { context?: Response }).context?.json();
      if (body?.error) message = body.error;
    } catch {
      // Keep the general message.
    }
    throw new Error(message);
  }
  return (data as { content: Content }).content;
}

/** Tiny formatter for the bot's answers: paragraphs, "- " bullets and **bold**. No HTML is ever injected. */
function renderText(text: string): ReactNode {
  const bold = (line: string) =>
    line.split(/(\*\*[^*]+\*\*)/g).map((piece, i) =>
      piece.startsWith("**") && piece.endsWith("**") ? <b key={i}>{piece.slice(2, -2)}</b> : piece,
    );
  const blocks: ReactNode[] = [];
  let bullets: string[] = [];
  const flush = () => {
    if (bullets.length) blocks.push(<ul key={blocks.length} className="ml-4 list-disc space-y-0.5">{bullets.map((b, i) => <li key={i}>{bold(b)}</li>)}</ul>);
    bullets = [];
  };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const bullet = line.match(/^(?:[-*•]|\d+\.)\s+(.*)$/);
    if (bullet) { bullets.push(bullet[1]); continue; }
    flush();
    if (line) blocks.push(<p key={blocks.length}>{bold(line)}</p>);
  }
  flush();
  return <div className="space-y-1.5">{blocks}</div>;
}

/** Floating "Ask Slotted" assistant, powered by Google Gemini through our server function. */
export function ChatBot({ courses, schedule, term }: { courses: Course[]; schedule: ScheduleApi; term: "first_term" | "second_term" }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [history, setHistory] = useState<Content[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [ratings, setRatings] = useState<Map<string, Ratings>>(new Map());
  const [done, setDone] = useState<Set<string>>(new Set()); // proposals the student accepted
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const byCode = useMemo(() => new Map(courses.map((c) => [c.code, c])), [courses]);

  useEffect(() => {
    if (open && ratings.size === 0) allCourseRatings().then(setRatings).catch(() => undefined);
    if (open) inputRef.current?.focus();
  }, [open, ratings.size]);
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  async function send(text: string) {
    const question = text.trim().slice(0, 500);
    if (!question || busy) return;
    setInput("");
    setMessages((m) => [...m, { from: "me", text: question }]);
    setBusy(true);

    const env: ToolEnv = { courses, byCode, schedule, ratings };
    const proposals: Proposal[] = [];
    let contents: Content[] = [...history, { role: "user", parts: [{ text: question }] }];
    try {
      for (let round = 0; ; round++) {
        const reply = await askServer(contents, describeStudent(env, term));
        contents = [...contents, reply];
        const calls = reply.parts.filter((p) => p.functionCall);
        if (calls.length === 0 || round >= MAX_TOOL_ROUNDS) {
          const answer = reply.parts.filter((p) => p.text && !p.thought).map((p) => p.text).join("").trim();
          setMessages((m) => [...m, { from: "bot", text: answer || "Done. Check the buttons below.", proposals }]);
          break;
        }
        // Run the tools here in the browser, then send the results back to Gemini.
        contents = [...contents, {
          role: "user",
          parts: calls.map((p) => ({
            functionResponse: {
              name: p.functionCall!.name,
              ...(p.functionCall!.id ? { id: p.functionCall!.id } : {}),
              response: { result: runTool(env, p.functionCall!.name, p.functionCall!.args ?? {}, proposals) },
            },
          })),
        }];
      }
      setHistory(contents);
    } catch (e) {
      setMessages((m) => [...m, { from: "bot", text: (e as Error).message, error: true }]);
    } finally {
      setBusy(false);
    }
  }

  function accept(p: Proposal) {
    if (p.kind === "add") schedule.addCourse(p.code);
    else schedule.removeCourse(p.code);
    setDone((d) => new Set(d).add(`${p.kind}|${p.code}`));
  }

  function newChat() {
    setMessages([]);
    setHistory([]);
    setDone(new Set());
  }

  return (
    <>
      {!open && (
        <button type="button" onClick={() => setOpen(true)}
          className="fixed right-4 bottom-4 z-40 flex items-center gap-2 rounded-full bg-brand-700 px-5 py-3 font-semibold text-white shadow-lg transition hover:scale-105 hover:bg-brand-800">
          <span aria-hidden className="text-lg">✨</span> Ask Slotted
        </button>
      )}

      {open && (
        <section role="dialog" aria-label="Slotted assistant"
          className="fixed inset-x-2 bottom-2 z-40 flex max-h-[80vh] flex-col overflow-hidden rounded-2xl border border-line bg-white shadow-2xl sm:inset-x-auto sm:right-4 sm:bottom-4 sm:w-[400px]">
          <header className="flex items-center gap-2 bg-brand-700 px-4 py-3 text-white">
            <span aria-hidden className="text-lg">✨</span>
            <div className="flex-1">
              <h2 className="font-display font-semibold leading-tight">Ask Slotted</h2>
              <p className="text-[11px] text-white/80">Knows your week, the course list and reviews</p>
            </div>
            {messages.length > 0 && (
              <button type="button" onClick={newChat} className="rounded-lg px-2 py-1 text-xs font-semibold text-white/90 hover:bg-white/15">New chat</button>
            )}
            <button type="button" onClick={() => setOpen(false)} aria-label="Close assistant" className="rounded-lg px-2 py-1 text-lg leading-none hover:bg-white/15">×</button>
          </header>

          <div ref={listRef} className="min-h-[220px] flex-1 space-y-3 overflow-y-auto bg-page px-3 py-3 text-sm" aria-live="polite">
            {messages.length === 0 && (
              <div className="space-y-2">
                <p className="text-muted">Hi! I can find courses that fit your week, compare them using reviews, and explain conflicts. Try:</p>
                {SUGGESTIONS.map((s) => (
                  <button key={s} type="button" onClick={() => void send(s)}
                    className="block w-full rounded-xl border border-line bg-white px-3 py-2 text-left hover:border-brand-200 hover:text-brand-700">
                    {s}
                  </button>
                ))}
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={m.from === "me" ? "flex justify-end" : ""}>
                <div className={m.from === "me"
                  ? "max-w-[85%] rounded-2xl rounded-br-sm bg-brand-700 px-3 py-2 text-white"
                  : `max-w-[92%] rounded-2xl rounded-bl-sm border px-3 py-2 ${m.error ? "border-conflict-200 bg-conflict-50 text-conflict-700" : "border-line bg-white"}`}>
                  {m.from === "me" ? m.text : renderText(m.text)}
                  {m.proposals?.map((p) => {
                    const key = `${p.kind}|${p.code}`;
                    return (
                      <div key={key} className="mt-2 rounded-xl bg-page p-2">
                        <p className="text-xs text-muted">{p.reason}</p>
                        <button type="button" disabled={done.has(key)} onClick={() => accept(p)}
                          className={`mt-1 rounded-lg px-3 py-1 text-xs font-semibold disabled:opacity-60 ${p.kind === "add" ? "bg-brand-700 text-white hover:bg-brand-800" : "border border-conflict-600 text-conflict-700"}`}>
                          {done.has(key) ? (p.kind === "add" ? `✓ Added ${p.code}` : `✓ Removed ${p.code}`) : (p.kind === "add" ? `Add ${p.code} to my week` : `Remove ${p.code}`)}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
            {busy && <p className="text-muted" role="status"><span className="inline-block animate-pulse">Thinking…</span></p>}
          </div>

          <form className="border-t border-line p-2" onSubmit={(e) => { e.preventDefault(); void send(input); }}>
            <div className="flex items-end gap-2">
              <label htmlFor="chat-input" className="sr-only">Message</label>
              <textarea id="chat-input" ref={inputRef} rows={1} value={input} maxLength={500}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(input); } }}
                placeholder="Ask about courses or your week…"
                className="max-h-28 min-h-[38px] flex-1 resize-none rounded-xl border border-line px-3 py-2 text-sm" />
              <button type="submit" disabled={busy || !input.trim()}
                className="rounded-xl bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-50">
                Send
              </button>
            </div>
            <p className="mt-1 px-1 text-[10px] text-muted">
              Answers come from Google Gemini and can be wrong. Don't share personal info. Check prerequisites with the Academic Calendar.
            </p>
          </form>
        </section>
      )}
    </>
  );
}
