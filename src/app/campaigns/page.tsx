import { Shell } from "@/components/shell";
import { demoCampaigns } from "@/lib/demo/data";

export default function CampaignsPage() {
  return (
    <Shell
      title="Campaigns"
      subtitle="Sequences of RVM steps with delays, stop-on-callback, consent gates, timezone windows, and automatic line rotation across the pool."
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
          Sequencer behavior (v1 design)
        </h2>
        <ul className="mt-3 space-y-2 text-sm text-[var(--muted)]">
          <li>
            · Pick next enrollment due (`nextRunAt`), run compliance gate (consent / DNC /
            8–9 style window in recipient TZ).
          </li>
          <li>
            · `pickLine()` for local presence + lowest utilization + healthy reputation.
          </li>
          <li>
            · Render script (`{"{{first_name}}"}`) → TTS or static asset → provider.send().
          </li>
          <li>
            · Increment line `sentToday`; advance step or complete; stop on callback / opt-out.
          </li>
        </ul>
      </div>
    </Shell>
  );
}
