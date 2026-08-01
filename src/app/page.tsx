import { Shell } from "@/components/shell";
import { costMatrix, demoCampaigns, demoLines, warmupSchedule } from "@/lib/demo/data";
import { poolRemainingCapacity } from "@/lib/sequencer/line-picker";

export default function HomePage() {
  const remaining = poolRemainingCapacity(
    demoLines.map((l) => ({
      ...l,
      status: l.status,
    })),
  );
  const healthy = demoLines.filter((l) => l.status === "HEALTHY").length;
  const quarantined = demoLines.filter((l) => l.status === "QUARANTINED").length;
  const underBudget = costMatrix.filter((c) => c.under100).length;

  return (
    <Shell
      title="Fleet overview"
      subtitle="Buy Twilio DIDs, warm them like mailboxes, rotate sends, and watch for burned caller IDs — deposit via Drop.co PAYG (or Slybroadcast), voice rendered once at ElevenLabs quality."
    >
      <section className="grid gap-4 md:grid-cols-4">
        {[
          { label: "Lines healthy", value: String(healthy) },
          { label: "Pool capacity today", value: String(remaining) },
          { label: "Quarantined", value: String(quarantined) },
          { label: "2k-run plans ≤ $100", value: String(underBudget) },
        ].map((stat) => (
          <div key={stat.label} className="panel rounded-xl p-4">
            <p className="text-xs uppercase tracking-[0.14em] text-[var(--muted)]">
              {stat.label}
            </p>
            <p className="mt-2 font-[family-name:var(--font-display)] text-3xl">
              {stat.value}
            </p>
          </div>
        ))}
      </section>

      <section className="mt-8 grid gap-6 lg:grid-cols-2">
        <div className="panel rounded-xl p-5">
          <h2 className="font-[family-name:var(--font-display)] text-xl">
            Active campaigns
          </h2>
          <ul className="mt-4 divide-y divide-[var(--line)]">
            {demoCampaigns.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-4 py-3">
                <div>
                  <p className="font-medium">{c.name}</p>
                  <p className="text-xs text-[var(--muted)]">
                    {c.enrolled.toLocaleString()} enrolled · {c.mode} / {c.provider}
                  </p>
                </div>
                <div className="text-right">
                  <span
                    className={`badge ${c.status === "ACTIVE" ? "badge-ok" : "badge-warn"}`}
                  >
                    {c.status}
                  </span>
                  <p className="mt-1 font-[family-name:var(--font-mono)] text-xs text-[var(--muted)]">
                    {c.deliveredToday}/{c.sentToday} delivered today
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="panel rounded-xl p-5">
          <h2 className="font-[family-name:var(--font-display)] text-xl">
            Default warmup ramp
          </h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Seed 20/day, +25% every 2 days, target 80/day by day ~13. Pause on spam
            labels.
          </p>
          <div className="mt-4 grid grid-cols-4 gap-2 sm:grid-cols-8">
            {warmupSchedule.slice(0, 16).map((d) => (
              <div
                key={d.day}
                className="rounded-lg border border-[var(--line)] bg-white/70 px-2 py-2 text-center"
              >
                <p className="text-[10px] uppercase text-[var(--muted)]">D{d.day}</p>
                <p className="font-[family-name:var(--font-mono)] text-sm">
                  {d.dailyCap}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="panel mt-8 rounded-xl p-5">
        <h2 className="font-[family-name:var(--font-display)] text-xl">
          Cost reality check — 2,000 drops
        </h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Your &lt;$100 target is achievable with static or Topa-class AI metering.
          Full 1:1 personalized TTS on expensive RVM units often is not.
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="text-xs uppercase tracking-wider text-[var(--muted)]">
              <tr>
                <th className="pb-2 font-medium">Delivery</th>
                <th className="pb-2 font-medium">Voice</th>
                <th className="pb-2 font-medium">Total</th>
                <th className="pb-2 font-medium">Per drop</th>
                <th className="pb-2 font-medium">≤ $100?</th>
              </tr>
            </thead>
            <tbody>
              {costMatrix.map((row) => (
                <tr key={`${row.delivery}-${row.tts}`} className="border-t border-[var(--line)]">
                  <td className="py-2.5 pr-3">{row.delivery}</td>
                  <td className="py-2.5 pr-3 text-[var(--muted)]">{row.tts}</td>
                  <td className="py-2.5 pr-3 font-[family-name:var(--font-mono)]">
                    ${row.totalUsd.toFixed(2)}
                  </td>
                  <td className="py-2.5 pr-3 font-[family-name:var(--font-mono)]">
                    ${row.perDropUsd.toFixed(4)}
                  </td>
                  <td className="py-2.5">
                    <span className={`badge ${row.under100 ? "badge-ok" : "badge-danger"}`}>
                      {row.under100 ? "Yes" : "No"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </Shell>
  );
}
