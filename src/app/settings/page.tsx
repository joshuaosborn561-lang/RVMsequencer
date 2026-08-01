import { Shell } from "@/components/shell";

const findings = [
  {
    title: "PAYG default: Drop.co",
    body: "No monthly fee, $0.05/drop at entry (~$100 for 2k), modern Customer API + webhooks + pacing. Best match if you want true pay-as-you-go with a sequencer-friendly API. Slybroadcast PAYG is the alt (never-expire credits + c_callerID); LeadsRain is cheapest cents but legacy API.",
  },
  {
    title: "Voice cost if you generate once",
    body: "Negligible. ElevenLabs Multilingual (highest quality TTS tier) is ~$0.03–$0.05 to render a ~40s script once. Clone yourself with Professional Voice Clone on Creator (~$22/mo). Host the file; reuse the same URL on every drop. Regenerating per lead is what gets expensive — you don’t need that.",
  },
  {
    title: "Consent posture",
    body: "Operator choice here: cold-call / grey-area style. Consent is soft/warn by default; DNC + send windows stay hard. FCC 22-85 exists; court application varies. Not legal advice.",
  },
  {
    title: "Not recommended for Dropseq",
    body: "myringlessvoicemail.com is ~1.85¢ but has no public developer API. Drop Cowboy is overkill if you only need deposit. VoiceDrop is pricier for static PAYG at low volume.",
  },
];

export default function SettingsPage() {
  return (
    <Shell
      title="Decisions"
      subtitle="PAYG deposit API + one-shot high-quality voice. Details in docs/RESEARCH.md."
    >
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
