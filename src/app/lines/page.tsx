"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { demoLines } from "@/lib/demo/data";
import {
  lineReputationView,
  reputationRiskHint,
  type ReputationRiskHint,
} from "@/lib/reputation/check";
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

type LineRow = LineRecord & {
  score?: number | null;
  source?: string | null;
  reportCount?: number | null;
  riskHint?: ReputationRiskHint;
};

function riskClass(hint: ReputationRiskHint): string {
  if (hint === "Likely spam") return "badge-danger";
  if (hint === "Elevated") return "badge-warn";
  if (hint === "Clean") return "badge-ok";
  return "badge-muted";
}

function formatCheckedAt(iso?: string | null): string {
  if (!iso) return "Never";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function toRow(line: LineRecord): LineRow {
  const view = lineReputationView(line);
  return {
    ...line,
    score: view.score,
    source: view.source,
    reportCount: view.reportCount,
    lastReputationCheckAt: view.lastReputationCheckAt ?? undefined,
    riskHint: view.riskHint,
  };
}

export default function LinesPage() {
  const [sub, setSub] = useState<SubTab>("accounts");
  const [lines, setLines] = useState<LineRow[]>([]);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/lines");
        if (res.ok) {
          const data = (await res.json()) as { lines?: LineRow[] };
          if (Array.isArray(data.lines) && data.lines.length > 0) {
            setLines(
              data.lines.map((l) => ({
                ...l,
                riskHint:
                  l.riskHint ??
                  reputationRiskHint(l.reputationLabel, l.score ?? l.reputationScore),
              })),
            );
            return;
          }
        }
      } catch {
        /* demo fallback */
      }
      setLines(demoLines.map((l) => toRow(l)));
    })();
  }, []);

  return (
    <AppShell
      title="Phone Lines"
      subtitle="Twilio DIDs = Smartlead Email Accounts — warmup, daily caps, external spam likelihood."
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
          external spam labels (CallTracer / optional Hiya). Per-line warmup day
          and daily cap appear in the Phone Lines table.
        </div>
      ) : null}

      {sub === "health" ? (
        <div className="rounded-xl border border-[var(--line)] bg-white p-5 text-sm text-[var(--muted)]">
          <p>
            Quarantine <strong>FLAGGED</strong> and degrade{" "}
            <strong>MIXED_HIGH</strong> from CallTracer (or Hiya if configured).
            Callback rates are monitoring metrics only — unused DIDs are never
            auto-degraded. Last check and spam score are stored so this page does
            not hit paid APIs.
          </p>
          <p className="mt-2">
            Force-refresh a DID via authenticated{" "}
            <code>GET /api/reputation/check?refresh=1&amp;e164=+1…</code>{" "}
            (CRON_SECRET).
          </p>
        </div>
      ) : null}

      {sub === "accounts" ? (
        <div className="sl-table-wrap overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-[var(--bg)] text-[11px] uppercase tracking-wider text-[var(--muted)]">
              <tr>
                <th className="px-4 py-3 font-medium">Number</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Warm day</th>
                <th className="px-4 py-3 font-medium">Daily limit</th>
                <th className="px-4 py-3 font-medium">Sent today</th>
                <th className="px-4 py-3 font-medium">Spam likelihood</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => {
                const hint =
                  line.riskHint ??
                  reputationRiskHint(
                    line.reputationLabel,
                    line.score ?? line.reputationScore,
                  );
                const score = line.score ?? line.reputationScore;
                const source = line.source ?? line.reputationSource ?? "—";
                const reports = line.reportCount ?? line.reputationReportCount;
                return (
                  <tr key={line.id} className="border-t border-[var(--line)] align-top">
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
                      <span className={`badge ${riskClass(hint)}`}>{hint}</span>
                      <p className="mt-1.5 text-xs text-[var(--muted)]">
                        {line.reputationLabel}
                        {score != null ? ` · score ${score}` : ""}
                        {` · ${source}`}
                        {reports != null ? ` · ${reports} reports` : ""}
                      </p>
                      <p className="text-xs text-[var(--muted)]">
                        Last check {formatCheckedAt(line.lastReputationCheckAt)}
                      </p>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </AppShell>
  );
}
