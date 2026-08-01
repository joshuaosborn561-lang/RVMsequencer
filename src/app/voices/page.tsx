import { Shell } from "@/components/shell";

const voices = [
  {
    name: "Stock — Mira",
    provider: "CARTESIA",
    kind: "Stock",
    note: "Cheap bulk; good default for static body audio.",
  },
  {
    name: "Clone — Founder",
    provider: "ELEVENLABS",
    kind: "Instant clone",
    note: "Use for Part-2 body or full personalized scripts when quality matters.",
  },
  {
    name: "Upload — Live take",
    provider: "UPLOAD",
    kind: "Human WAV",
    note: "Best deliverability optics when you can record once and reuse.",
  },
];

export default function VoicesPage() {
  return (
    <Shell
      title="Voice engine"
      subtitle="Clone or stock TTS for RVM audio. Cost tip: Topa-style Part1 (short personalized) + Part2 (shared body) beats full per-lead synthesis for the $100/2k target."
    >
      <div className="grid gap-4 md:grid-cols-3">
        {voices.map((v) => (
          <article key={v.name} className="panel rounded-xl p-5">
            <p className="badge badge-muted">{v.provider}</p>
            <h2 className="mt-3 font-[family-name:var(--font-display)] text-xl">
              {v.name}
            </h2>
            <p className="mt-1 text-xs uppercase tracking-wider text-[var(--muted)]">
              {v.kind}
            </p>
            <p className="mt-3 text-sm leading-relaxed text-[var(--muted)]">{v.note}</p>
          </article>
        ))}
      </div>

      <div className="panel mt-6 rounded-xl p-5 text-sm leading-relaxed">
        <p className="font-medium">Recommended stack</p>
        <ul className="mt-3 space-y-2 text-[var(--muted)]">
          <li>
            · <strong className="text-[var(--ink)]">Cartesia</strong> for volume + instant
            clone economics (~$0.039/1k chars on Startup).
          </li>
          <li>
            · <strong className="text-[var(--ink)]">ElevenLabs Flash</strong> when you need
            punchier naturalism (~$0.05/1k chars).
          </li>
          <li>
            · Prefer <strong className="text-[var(--ink)]">static reuse</strong> or splice
            personalization so TTS is not the budget killer.
          </li>
          <li>
            · Provider-bundled AI (Topa ~2.5¢ all-in) is the competitive floor to beat with
            BYOC + own TTS.
          </li>
        </ul>
      </div>
    </Shell>
  );
}
