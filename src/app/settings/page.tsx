import { Shell } from "@/components/shell";

const findings = [
  {
    title: "FCC note (brief)",
    body: "FCC 22-85 (Nov 2022) is a federal declaratory ruling that RVM to wireless is a TCPA “call.” Court application of consent form and liability still varies — grey in practice, not “no federal ruling.” Dropseq keeps consent gates configurable.",
  },
  {
    title: "Skip Drop Cowboy unless you need the suite",
    body: "If you just need an API + cheap deposits, Cowboy’s platform TCO is the wrong default. Use Slybroadcast, Drop.co, or LeadsRain.",
  },
  {
    title: "Default deposit: Slybroadcast",
    body: "$100/mo for 2,000 successful drops hits your budget exactly. Public JSON API, c_callerID for Twilio DIDs, delivery postbacks. PAYG credits never expire if you prefer packs.",
  },
  {
    title: "Alt: Drop.co or LeadsRain",
    body: "Drop.co = $0.05/drop at low volume, modern Customer API, no monthly fee. LeadsRain = ~1.5–2¢ static (cheapest cents) with a legacy API.",
  },
  {
    title: "Voice stays yours",
    body: "Render clone/stock audio with Cartesia or ElevenLabs (or upload WAV), host the file, pass URL to the RVM API. Keep TTS amortized via static or Part1/Part2 splice.",
  },
];

export default function SettingsPage() {
  return (
    <Shell
      title="Research summary"
      subtitle="Cheaper API path + legal posture. Deep dive in docs/RESEARCH.md."
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
