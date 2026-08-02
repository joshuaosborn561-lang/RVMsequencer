"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { demoLines } from "@/lib/demo/data";
import type { LineRecord } from "@/lib/store/types";

const statusClass: Record<string, string> = {
  HEALTHY: "badge-ok",
  WARMING: "badge-warn",
  DEGRADED: "badge-warn",
  QUARANTINED: "badge-danger",
  PROVISIONING: "badge-muted",
  RETIRED: "badge-muted",
};

type SubTab = "accounts" | "warmup" | "health";

export default function LinesPage() {
  const [sub, setSub] = useState<SubTab>("accounts");
  const [lines, setLines] = useState<LineRecord[]>([]);

  useEffect(() => {
    // Prefer live store lines when API exists; fall back to demo shape
    void (async () => {
      try {
        const res = await fetch("/api/health");
        if (res.ok) {
          // Map demo into LineRecord-compatible rows for display
          setLines(
            demoLines.map((l) => ({
              id: l.id,
              e164: l.e164,
              areaCode: l.areaCode,
              status: l.status,
              warmupDay: l.warmupDay,
              dailyCap: l.dailyCap,
              sentToday: l.sentToday,
              reputationLabel: l.reputationLabel,
              minGapSec: 600,
            })),
          );
          return;
        }
      } catch {
        /* demo */
      }
      setLines(
        demoLines.map((l) => ({
          id: l.id,
          e164: l.e164,
          areaCode: l.areaCode,
          status: l.status,
          warmupDay: l.warmupDay,
          dailyCap: l.dailyCap,
          sentToday: l.sentToday,
          reputationLabel: l.reputationLabel,
          minGapSec: 600,
        })),
      );
    })();
  }, []);

  return (
    <AppShell
      title="Phone Lines"
      subtitle="Twilio DIDs = Smartlead Email Accounts — warmup, daily caps, reputation."
      actions={
        <button type="button" className="sl-btn sl-btn-primary">
          + Connect number
        </button>
      }
    >
      <div className="sl-tabs">
        {(
          [
            ["accounts", "Phone Lines"],
            ["warmup", "Warm-Up"],
            ["health", "Health"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`sl-tab ${sub === id ? "sl-tab-active" : ""}`}
            onClick={() => setSub(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {sub === "warmup" ? (
        <div className="rounded-xl border border-[var(--line)] bg-white p-5 text-sm text-[var(--muted)]">
          Default ramp: seed 20/day, +25% every 2 days, target ~80/day. Pause on
          spam labels. Per-line warmup day and daily cap appear in the Phone
          Lines table.
        </div>
      ) : null}

      {sub === "health" ? (
        <div className="rounded-xl border border-[var(--line)] bg-white p-5 text-sm text-[var(--muted)]">
          Quarantine FLAGGED numbers. MIXED reputation lowers pick weight.
          Min gap between deposits defaults to 600s.
        </div>
      ) : null}

      {sub === "accounts" ? (
        <div className="sl-table-wrap">
          <table className="w-full text-left text-sm">
            <thead className="bg-[var(--bg)] text-[11px] uppercase tracking-wider text-[var(--muted)]">
              <tr>
                <th className="px-4 py-3 font-medium">Number</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Warm day</th>
                <th className="px-4 py-3 font-medium">Daily limit</th>
                <th className="px-4 py-3 font-medium">Sent today</th>
                <th className="px-4 py-3 font-medium">Reputation</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.id} className="border-t border-[var(--line)]">
                  <td className="px-4 py-3">
                    <p className="font-[family-name:var(--font-mono)]">
                      {line.e164}
                    </p>
                    <p className="text-xs text-[var(--muted)]">
                      NPA {line.areaCode}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`badge ${statusClass[line.status] ?? "badge-muted"}`}>
                      {line.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-[family-name:var(--font-mono)]">
                    {line.warmupDay}
                  </td>
                  <td className="px-4 py-3 font-[family-name:var(--font-mono)]">
                    {line.dailyCap}
                  </td>
                  <td className="px-4 py-3 font-[family-name:var(--font-mono)]">
                    {line.sentToday}
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </AppShell>
  );
}
