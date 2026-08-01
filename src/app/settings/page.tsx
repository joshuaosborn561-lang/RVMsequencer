import Link from "next/link";
import { AppShell } from "@/components/app-shell";

const checklist = [
  {
    title: "API keys",
    body: "Drop.co, ElevenLabs, DNC Project, Twilio, NEXT_PUBLIC_APP_URL — see .env.example.",
  },
  {
    title: "Public HTTPS host",
    body: "Deploy so Drop.co can fetch audio URLs and Twilio can hit inbound webhooks.",
  },
  {
    title: "Postgres",
    body: "DATABASE_URL + pnpm db:push. Until then .data/ file store works for single-node demos.",
  },
  {
    title: "Cron",
    body: "POST /api/sequencer/tick every minute while campaigns are ACTIVE.",
  },
  {
    title: "Twilio → Master Inbox",
    body: "Point DID Voice/Messaging URLs to /api/webhooks/twilio/inbound.",
  },
  {
    title: "Auth",
    body: "Add login before real client data. Per-client API keys live under Clients / API.",
  },
];

export default function SettingsPage() {
  return (
    <AppShell
      title="Go live"
      subtitle="What we need from you to leave mock mode — full detail in docs/GO_LIVE.md."
      actions={
        <Link
          href="/campaigns"
          className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white"
        >
          Open campaigns
        </Link>
      }
    >
      <div className="grid gap-4">
        {checklist.map((f, i) => (
          <article key={f.title} className="panel rounded-xl p-5">
            <p className="text-xs uppercase tracking-[0.14em] text-[var(--muted)]">
              Step {i + 1}
            </p>
            <h2 className="mt-1 font-[family-name:var(--font-display)] text-xl">
              {f.title}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">
              {f.body}
            </p>
          </article>
        ))}
      </div>
    </AppShell>
  );
}
