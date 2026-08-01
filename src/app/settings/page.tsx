import { Shell } from "@/components/shell";

const findings = [
  {
    title: "Twilio cannot do true RVM alone",
    body: "Programmable Voice rings the handset. True ringless deposit needs a specialized RVM provider. Use Twilio for DID inventory + optional AMD fallback; Drop Cowboy BYOC or VoiceDrop/Slybroadcast for deposit.",
  },
  {
    title: "TCPA applies (FCC 22-85)",
    body: "Ringless voicemail to wireless is a “call.” Prior express consent is required. Dropseq hard-gates consent / DNC / send windows by default.",
  },
  {
    title: "$100 / 2k is realistic — with the right metering",
    body: "Topa-class ~2.5¢ AI drops or cheap static RVM + reused audio clear the bar. Full per-lead ElevenLabs Multilingual + pricey AI RVM units often does not.",
  },
  {
    title: "Warmup is DID reputation, not magic RVM sauce",
    body: "Start ~20/day, +20–30% every 2–3 days, target 75–100/day/line. Register FCR + Voice Integrity first. Quarantine on spam labels or delivery collapse.",
  },
  {
    title: "Product wedge vs Topa",
    body: "Topa is a great channel bolt-on. Dropseq is the Smartlead layer: own the line pool, warmup, rotation, campaigns, and burn monitoring.",
  },
];

export default function SettingsPage() {
  return (
    <Shell
      title="Research summary"
      subtitle="Full write-up with sources lives in the repo. This page is the operator-facing distillation."
    >
      <div className="grid gap-4">
        {findings.map((f) => (
          <article key={f.title} className="panel rounded-xl p-5">
            <h2 className="font-[family-name:var(--font-display)] text-xl">{f.title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">{f.body}</p>
          </article>
        ))}
      </div>

      <p className="mt-6 text-sm text-[var(--muted)]">
        Deep dive in the repo at <code className="font-[family-name:var(--font-mono)]">docs/RESEARCH.md</code>.
        Open decisions: primary RVM partner, Cartesia vs ElevenLabs, Part1/Part2 splice vs
        full TTS, consent hard-gate policy.
      </p>
    </Shell>
  );
}
