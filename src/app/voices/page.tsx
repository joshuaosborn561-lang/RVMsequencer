import { AppShell } from "@/components/app-shell";

const items = [
  {
    name: "Hosted audio URL",
    provider: "SLYBROADCAST",
    kind: "Required",
    note: "Upload WAV/MP3 (≥5 seconds) somewhere public. Paste the URL on the campaign Sequence tab. Slybroadcast fetches it per drop and sets c_callerID to your Twilio DID.",
  },
  {
    name: "Twilio caller ID pool",
    provider: "TWILIO",
    kind: "Your burners",
    note: "Line picker rotates / sticks DIDs. Each send passes the chosen number as Slybroadcast c_callerID so callbacks hit Master Inbox.",
  },
  {
    name: "Drop Cowboy recording",
    provider: "DROP_COWBOY",
    kind: "Optional alt",
    note: "Only if RVM_PROVIDER=dropcowboy. Retail Drop Cowboy cannot use your Twilio DIDs as CID without BYOC.",
  },
];

export default function VoicesPage() {
  return (
    <AppShell
      title="Voices"
      subtitle="Default delivery is Slybroadcast — host audio once, reuse the URL."
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
    </AppShell>
  );
}
