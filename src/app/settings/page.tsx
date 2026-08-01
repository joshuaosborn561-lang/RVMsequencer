import { Shell } from "@/components/shell";

const findings = [
  {
    title: "Stack locked",
    body: "Drop.co PAYG for deposit. ElevenLabs Multilingual/PVC for voice (generate once). Recipient-local send windows from phone NPA. DNC scrub via The DNC Project API + internal suppression list.",
  },
  {
    title: "Send windows",
    body: "Campaign schedule uses recipient local hour/day (Google libphonenumber timezone prefixes). Outside window → skip and compute nextEligibleAt. Same idea as Smartlead’s timezone schedules.",
  },
  {
    title: "Env vars you need",
    body: "DROP_CO_API_KEY, DROP_CO_CAMPAIGN_TOKEN, ELEVENLABS_API_KEY, ELEVENLABS_DEFAULT_VOICE_ID, DNC_PROJECT_API_TOKEN, NEXT_PUBLIC_APP_URL. See .env.example.",
  },
  {
    title: "Consent posture",
    body: "Soft/warn by default (cold-call style). DNC + opt-out + local send windows stay hard.",
  },
];

export default function SettingsPage() {
  return (
    <Shell title="Decisions" subtitle="What we’re building against.">
      <div className="grid gap-4">
        {findings.map((f) => (
          <article key={f.title} className="panel rounded-xl p-5">
            <h2 className="font-[family-name:var(--font-display)] text-xl">{f.title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">{f.body}</p>
          </article>
        ))}
      </div>
    </Shell>
  );
}
