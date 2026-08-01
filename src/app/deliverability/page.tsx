import { Shell } from "@/components/shell";
import { demoLines } from "@/lib/demo/data";
import { evaluateLineHealth } from "@/lib/reputation/evaluate";

export default function DeliverabilityPage() {
  const rows = demoLines.map((line) => {
    const verdict = evaluateLineHealth({
      deliveryRate7d: line.deliveryRate7d,
      callbackRate7d: line.callbackRate7d,
      spamLabel: line.reputationLabel,
      attempts7d: 80,
      optOutRate7d: line.status === "QUARANTINED" ? 0.04 : 0.008,
    });
    return { line, verdict };
  });

  return (
    <Shell
      title="Deliverability monitor"
      subtitle="Burn detection combines provider delivery webhooks, callback rates, opt-outs, and carrier analytics labels (Hiya / TNS / First Orion via Voice Integrity or handset probes)."
    >
      <div className="grid gap-4">
        {rows.map(({ line, verdict }) => (
          <article key={line.id} className="panel rounded-xl p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-[family-name:var(--font-mono)] text-lg">
                  {line.e164}
                </p>
                <p className="text-sm text-[var(--muted)]">
                  Delivery {(line.deliveryRate7d * 100).toFixed(0)}% · Callbacks{" "}
                  {(line.callbackRate7d * 100).toFixed(1)}% · Label{" "}
                  {line.reputationLabel}
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
    </Shell>
  );
}
