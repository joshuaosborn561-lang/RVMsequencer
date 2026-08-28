import { AppShell } from "@/components/app-shell";

const items = [
  {
    name: "Drop Cowboy recording",
    provider: "DROP_COWBOY",
    kind: "Required",
    note: "Upload your WAV/MP3 in Drop Cowboy → Recordings, get compliance approval, then paste the recording GUID on the campaign Sequence tab.",
  },
  {
    name: "Hosted audio URL",
    provider: "AUDIO_URL",
    kind: "Optional / approval",
    note: "Drop Cowboy’s audio_url field needs account approval or BYOC. Prefer recording_id unless support has enabled this for you.",
  },
  {
    name: "Return-call DID",
    provider: "TWILIO",
    kind: "Your lines",
    note: "Sequencer passes the picked Twilio line as forwarding_number so callbacks hit Master Inbox and stopOnCallback can suppress.",
  },
];

export default function VoicesPage() {
  return (
    <AppShell
      title="Voices"
      subtitle="Audio lives in Drop Cowboy. This app does not render TTS."
    >
      <div className="grid gap-4 md:grid-cols-3">
        {items.map((v) => (
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
          Deposit is the bill (Drop Cowboy plan rate per successful drop). Reuse one
          approved recording across the whole campaign — no per-lead TTS in this stack.
        </p>
      </div>
    </AppShell>
  );
}
