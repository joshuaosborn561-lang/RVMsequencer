import { Shell } from "@/components/shell";
import { demoCampaigns } from "@/lib/demo/data";

export default function CampaignsPage() {
  return (
    <Shell
      title="Campaigns"
      subtitle="Smartlead-style schedules in the recipient’s local time (from phone NPA), DNC scrub before every send, Drop.co deposit, ElevenLabs audio generated once."
    >
      <div className="grid gap-4">
        {demoCampaigns.map((c) => (
          <article key={c.id} className="panel rounded-xl p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-[family-name:var(--font-display)] text-xl">
                  {c.name}
                </h2>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  Delivery via {c.provider} · mode {c.mode}
                </p>
              </div>
              <span
                className={`badge ${c.status === "ACTIVE" ? "badge-ok" : "badge-warn"}`}
              >
                {c.status}
              </span>
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
              <div>
                <dt className="text-xs uppercase tracking-wider text-[var(--muted)]">
                  Enrolled
                </dt>
                <dd className="mt-1 font-[family-name:var(--font-mono)]">
                  {c.enrolled.toLocaleString()}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wider text-[var(--muted)]">
                  Sent today
                </dt>
                <dd className="mt-1 font-[family-name:var(--font-mono)]">
                  {c.sentToday}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wider text-[var(--muted)]">
                  Delivered today
                </dt>
                <dd className="mt-1 font-[family-name:var(--font-mono)]">
                  {c.deliveredToday}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wider text-[var(--muted)]">
                  Hit rate
                </dt>
                <dd className="mt-1 font-[family-name:var(--font-mono)]">
                  {c.sentToday
                    ? `${Math.round((c.deliveredToday / c.sentToday) * 100)}%`
                    : "—"}
                </dd>
              </div>
            </dl>
          </article>
        ))}
      </div>

      <div className="panel mt-6 rounded-xl p-5">
        <h2 className="font-[family-name:var(--font-display)] text-lg">
          Sequencer tick (wired)
        </h2>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-[var(--muted)]">
          <li>
            <code className="font-[family-name:var(--font-mono)] text-[var(--ink)]">
              POST /api/scrub
            </code>{" "}
            — internal list + The DNC Project (when token set)
          </li>
          <li>
            Recipient local clock from phone NPA (
            <code className="font-[family-name:var(--font-mono)] text-[var(--ink)]">
              GET /api/timezone?phone=
            </code>
            ) — send days + hours like Smartlead
          </li>
          <li>Pick Twilio line (cap / local presence / health)</li>
          <li>
            <code className="font-[family-name:var(--font-mono)] text-[var(--ink)]">
              POST /api/voice/render
            </code>{" "}
            — ElevenLabs Multilingual once, cached by script hash
          </li>
          <li>
            <code className="font-[family-name:var(--font-mono)] text-[var(--ink)]">
              POST /api/sequencer/tick
            </code>{" "}
            — Drop.co post record
          </li>
        </ol>
      </div>
    </Shell>
  );
}
