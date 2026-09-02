import { AppShell } from "@/components/app-shell";
import { demoLines } from "@/lib/demo/data";
import { lineReputationView } from "@/lib/reputation/check";
import { evaluateLineHealth } from "@/lib/reputation/evaluate";
import { listLines } from "@/lib/store/db";

export default async function DeliverabilityPage() {
  const stored = await listLines().catch(() => []);
  const rows = (stored.length ? stored : demoLines).map((line) => {
    const view = lineReputationView(line);
    const verdict = evaluateLineHealth({
      deliveryRate7d: "deliveryRate7d" in line ? line.deliveryRate7d : null,
      callbackRate7d: line.callbackRate7d ?? null,
      spamLabel: line.reputationLabel,
      attempts7d: line.sentToday > 0 ? Math.max(line.sentToday, 1) : 0,
      optOutRate7d: line.status === "QUARANTINED" ? 0.04 : 0.008,
    });
    return { line, view, verdict };
  });

  return (
    <AppShell
      title="Deliverability"
      subtitle="Line reputation from CallTracer / optional Hiya — score, source, last check. Callback rates are monitoring only."
    >
      <div className="grid gap-4">
        {rows.map(({ line, view, verdict }) => (
          <article key={line.id} className="panel rounded-xl p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-[family-name:var(--font-mono)] text-lg">
                  {line.e164}
                </p>
                <p className="text-sm text-[var(--muted)]">
                  {view.riskHint} · {view.reputationLabel}
                  {view.score != null ? ` · score ${view.score}` : ""}
                  {view.source ? ` · ${view.source}` : ""}
                  {view.reportCount != null ? ` · ${view.reportCount} reports` : ""}
                </p>
                <p className="text-xs text-[var(--muted)]">
                  Last check{" "}
                  {view.lastReputationCheckAt
                    ? new Date(view.lastReputationCheckAt).toLocaleString()
                    : "never"}
                  {line.callbackRate7d != null
                    ? ` · callbacks ${(line.callbackRate7d * 100).toFixed(1)}% (monitor only)`
                    : ""}
                </p>
              </div>
              <span
                className={`badge ${
                  verdict.action === "quarantine"
                    ? "badge-danger"
                    : verdict.action === "degrade"
                      ? "badge-warn"
                      : "badge-ok"
                }`}
              >
                {verdict.action.toUpperCase()} → {verdict.statusHint}
              </span>
            </div>
            {"reason" in verdict ? (
              <p className="mt-3 text-sm text-[var(--muted)]">{verdict.reason}</p>
            ) : (
              <p className="mt-3 text-sm text-[var(--muted)]">
                Within healthy bands — keep in rotation.
              </p>
            )}
          </article>
        ))}
      </div>
    </AppShell>
  );
}
