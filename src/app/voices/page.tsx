import { AppShell } from "@/components/app-shell";

const voices = [
  {
    name: "Clone — you (PVC)",
    provider: "ELEVENLABS",
    kind: "Professional clone",
    note: "Highest quality path. Creator+ plan unlocks PVC; render the campaign script once (~pennies), reuse forever.",
  },
  {
    name: "Stock — Multilingual v2/v3",
    provider: "ELEVENLABS",
    kind: "Highest quality TTS",
    note: "~$0.10/1k chars. A 40s script ≈ $0.04 one time. Prefer this over Flash when audio is static.",
  },
  {
    name: "Upload — live take",
    provider: "UPLOAD",
    kind: "Human WAV",
    note: "Still valid if you record yourself. Zero TTS spend after upload.",
  },
];

export default function VoicesPage() {
  return (
    <AppShell
      title="Voices"
      subtitle="Campaign audio — generate once (ElevenLabs / upload), reuse URL on every drop."
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
        <p className="font-medium">Cost reality</p>
        <p className="mt-2 text-[var(--muted)]">
          Deposit dominates the bill (~$0.05 × 2,000 = $100 on Drop.co). One ElevenLabs
          Multilingual render is noise. Only flip on per-lead personalization later if
          callback lift pays for it.
        </p>
      </div>
    </AppShell>
  );
}
