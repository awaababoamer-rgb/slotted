/** Shown on the Builder until the student adds their first course. */
export function WelcomeGuide() {
  const steps = [
    { title: "Add your courses", text: "Search on the left, e.g. \"CS 2210B\" or \"calculus\". Sections are picked to fit around each other." },
    { title: "Spot clashes", text: "Overlapping classes get an orange outline, and the banner lists every clash." },
    { title: "Let Smart Resolve fix them", text: "Preview a fix on your week, then apply it. Lock any section you don't want moved." },
    { title: "Copy class numbers", text: "When it's conflict-free, copy the class numbers and paste them into Student Center." },
  ];
  return (
    <section className="rounded-2xl border border-brand-200 bg-brand-50 p-5">
      <h2 className="font-display text-xl font-bold text-brand-800">Welcome to Slotted</h2>
      <p className="mt-1 text-sm text-brand-800/80">Build a clash-free week in four steps.</p>
      <ol className="mt-4 grid gap-3 sm:grid-cols-2">
        {steps.map((s, i) => (
          <li key={s.title} className="flex gap-3 rounded-xl bg-white p-3 shadow-sm">
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-brand-700 text-sm font-bold text-white">{i + 1}</span>
            <div>
              <p className="text-sm font-semibold">{s.title}</p>
              <p className="text-xs text-muted">{s.text}</p>
            </div>
          </li>
        ))}
      </ol>
      <p className="mt-4 text-sm">
        Shortcut: <a href="#programs" className="font-semibold text-brand-700 hover:underline">pick your program</a> to add its courses at once (optional).
        Not sure what to take? <a href="#find" className="font-semibold text-brand-700 hover:underline">Find courses that fit →</a>
      </p>
    </section>
  );
}
