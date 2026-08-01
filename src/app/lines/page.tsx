import { AppShell } from "@/components/app-shell";
import { demoLines } from "@/lib/demo/data";

const statusClass: Record<string, string> = {
  HEALTHY: "badge-ok",
  WARMING: "badge-warn",
  DEGRADED: "badge-warn",
  QUARANTINED: "badge-danger",
};

export default function LinesPage() {
  return (
    <AppShell
      title="Line pool"
      subtitle="Twilio DIDs are the inboxes. Caps, warmup day, FCR / Voice Integrity registration, and spam labels decide whether a line can send."
    >
      <div className="panel overflow-hidden rounded-xl">
        <table className="w-full text-left text-sm">
          <thead className="bg-white/50 text-xs uppercase tracking-wider text-[var(--muted)]">
            <tr>
              <th className="px-4 py-3 font-medium">Number</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Warm day</th>
              <th className="px-4 py-3 font-medium">Today</th>
              <th className="px-4 py-3 font-medium">Delivery 7d</th>
              <th className="px-4 py-3 font-medium">Reputation</th>
              <th className="px-4 py-3 font-medium">Trust</th>
            </tr>
          </thead>
          <tbody>
            {demoLines.map((line) => (
              <tr key={line.id} className="border-t border-[var(--line)]">
                <td className="px-4 py-3">
                  <p className="font-[family-name:var(--font-mono)]">{line.e164}</p>
                  <p className="text-xs text-[var(--muted)]">NPA {line.areaCode}</p>
                </td>
                <td className="px-4 py-3">
                  <span className={`badge ${statusClass[line.status]}`}>{line.status}</span>
                </td>
                <td className="px-4 py-3 font-[family-name:var(--font-mono)]">
                  {line.warmupDay}
                </td>
                <td className="px-4 py-3 font-[family-name:var(--font-mono)]">
                  {line.sentToday}/{line.dailyCap}
                </td>
                <td className="px-4 py-3 font-[family-name:var(--font-mono)]">
                  {(line.deliveryRate7d * 100).toFixed(0)}%
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`badge ${
                      line.reputationLabel === "FLAGGED"
                        ? "badge-danger"
                        : line.reputationLabel.startsWith("MIXED")
                          ? "badge-warn"
                          : "badge-ok"
                    }`}
                  >
                    {line.reputationLabel}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-[var(--muted)]">
                  FCR {line.registeredFcr ? "✓" : "—"} · VI{" "}
                  {line.voiceIntegrity ? "✓" : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="panel mt-6 rounded-xl p-5 text-sm leading-relaxed text-[var(--muted)]">
        <p className="font-medium text-[var(--ink)]">Ops checklist per new Twilio DID</p>
        <ol className="mt-3 list-decimal space-y-1 pl-5">
          <li>Call the DID from AT&T / T-Mobile / Verizon handsets — catch recycled burns.</li>
          <li>Register Free Caller Registry + Twilio Voice Integrity + confirm SHAKEN A.</li>
          <li>Start warmup at ~15–25 drops/day; jitter timing; prefer consented contacts.</li>
          <li>Auto-quarantine on FLAGGED or delivery collapse; rotate a spare into the campaign.</li>
        </ol>
      </div>
    </AppShell>
  );
}
