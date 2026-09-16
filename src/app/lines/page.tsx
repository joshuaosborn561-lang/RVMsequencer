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

type AvailableRow = {
  e164: string;
  locality?: string;
  region?: string;
  inPool?: boolean;
  sid?: string;
};

export default function LinesPage() {
  const [sub, setSub] = useState<SubTab>("accounts");
  const [lines, setLines] = useState<LineRow[]>([]);
  const [connectOpen, setConnectOpen] = useState(false);
  const [areaCode, setAreaCode] = useState("");
  const [existingE164, setExistingE164] = useState("");
  const [source, setSource] = useState<"available" | "account">("available");
  const [results, setResults] = useState<AvailableRow[]>([]);
  const [searchBusy, setSearchBusy] = useState(false);
  const [buyBusy, setBuyBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function reloadLines() {
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
          return true;
        }
      }
    } catch {
      /* demo fallback */
    }
    return false;
  }

  useEffect(() => {
    void (async () => {
      const ok = await reloadLines();
      if (!ok) setLines(demoLines.map((l) => toRow(l)));
    })();
  }, []);

  async function searchNumbers(nextSource = source) {
    setSource(nextSource);
    setSearchBusy(true);
    setNotice(null);
    try {
      const qs = new URLSearchParams({ source: nextSource });
      if (areaCode.trim()) qs.set("areaCode", areaCode.trim());
      const res = await fetch(`/api/lines/available?${qs}`);
      const data = (await res.json()) as {
        numbers?: AvailableRow[];
        error?: string;
        hint?: string;
      };
      if (!res.ok) {
        setResults([]);
        setNotice(data.hint ? `${data.error}: ${data.hint}` : data.error ?? "Search failed");
        return;
      }
      setResults(data.numbers ?? []);
      if (!(data.numbers ?? []).length) setNotice("No numbers matched.");
    } catch {
      setNotice("Search failed");
    } finally {
      setSearchBusy(false);
    }
  }

  async function provision(opts: { e164?: string; areaCode?: string }) {
    const label = opts.e164 ?? opts.areaCode ?? "number";
    if (opts.e164) {
      const ok = window.confirm(
        `Add ${opts.e164} from Twilio to this pool? If it is not already on the account, Twilio will be charged for a new DID.`,
      );
      if (!ok) return;
    } else if (opts.areaCode) {
      const ok = window.confirm(
        `Buy the first available Twilio number in ${opts.areaCode}? This charges the Twilio account.`,
      );
      if (!ok) return;
    }
    setBuyBusy(label);
    setNotice(null);
    try {
      const res = await fetch("/api/lines/purchase", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(opts),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        purchased?: boolean;
        imported?: boolean;
        line?: { e164?: string };
        error?: string;
        hint?: string;
      };
      if (!res.ok || !data.ok) {
        setNotice(data.hint ? `${data.error}: ${data.hint}` : data.error ?? "Add failed");
        return;
      }
      const verb = data.purchased ? "Bought" : data.imported ? "Imported" : "Already in pool";
      setNotice(`${verb} ${data.line?.e164 ?? label}. Starts WARMING at 20/day.`);
      await reloadLines();
      if (results.length) await searchNumbers();
    } catch {
      setNotice("Add failed");
    } finally {
      setBuyBusy(null);
    }
  }

  return (
    <AppShell
      title="Phone Lines"
      subtitle="Twilio DIDs = Smartlead Email Accounts — warmup, daily caps, external spam likelihood."
      actions={
        <button
          type="button"
          className="sl-btn sl-btn-primary"
          onClick={() => setConnectOpen((v) => !v)}
        >
          {connectOpen ? "Close" : "+ Connect number"}
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

      {connectOpen ? (
        <div className="mb-4 rounded-xl border border-[var(--line)] bg-white p-5">
          <h2 className="font-[family-name:var(--font-display)] text-lg">
            Add a Twilio number
          </h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Search Twilio inventory and buy, or import a DID already on the
            account. New lines start WARMING (20/day). Buying charges Twilio.
          </p>
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="text-[var(--muted)]">Area code</span>
              <input
                className="sl-input font-[family-name:var(--font-mono)] w-28"
                value={areaCode}
                onChange={(e) => setAreaCode(e.target.value)}
                placeholder="214"
                inputMode="numeric"
              />
            </label>
            <button
              type="button"
              className="sl-btn sl-btn-ghost"
              disabled={searchBusy}
              onClick={() => void searchNumbers("available")}
            >
              {searchBusy && source === "available" ? "Searching…" : "Search to buy"}
            </button>
            <button
              type="button"
              className="sl-btn sl-btn-ghost"
              disabled={searchBusy}
              onClick={() => void searchNumbers("account")}
            >
              Show account numbers
            </button>
            <button
              type="button"
              className="sl-btn sl-btn-primary"
              disabled={!areaCode.trim() || Boolean(buyBusy)}
              onClick={() => void provision({ areaCode: areaCode.trim() })}
            >
              Buy first in {areaCode.trim() || "NPA"}
            </button>
          </div>
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="text-[var(--muted)]">Existing E.164</span>
              <input
                className="sl-input font-[family-name:var(--font-mono)] min-w-[200px]"
                value={existingE164}
                onChange={(e) => setExistingE164(e.target.value)}
                placeholder="+12145550123"
              />
            </label>
            <button
              type="button"
              className="sl-btn sl-btn-primary"
              disabled={!existingE164.trim() || Boolean(buyBusy)}
              onClick={() => void provision({ e164: existingE164.trim() })}
            >
              Add this number
            </button>
          </div>
          {notice ? (
            <p className="mt-3 text-sm text-[var(--muted)]">{notice}</p>
          ) : null}
          {results.length ? (
            <div className="sl-table-wrap mt-4 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-[var(--bg)] text-[11px] uppercase tracking-wider text-[var(--muted)]">
                  <tr>
                    <th className="px-4 py-3 font-medium">Number</th>
                    <th className="px-4 py-3 font-medium">Place</th>
                    <th className="px-4 py-3 font-medium">Pool</th>
                    <th className="px-4 py-3 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((row) => (
                    <tr key={row.e164} className="border-t border-[var(--line)]">
                      <td className="px-4 py-3 font-[family-name:var(--font-mono)]">
                        {row.e164}
                      </td>
                      <td className="px-4 py-3 text-[var(--muted)]">
                        {[row.locality, row.region].filter(Boolean).join(", ") || "—"}
                      </td>
                      <td className="px-4 py-3 text-[var(--muted)]">
                        {row.inPool ? "In pool" : "New"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          className="sl-btn sl-btn-primary"
                          disabled={Boolean(row.inPool) || Boolean(buyBusy)}
                          onClick={() => void provision({ e164: row.e164 })}
                        >
                          {buyBusy === row.e164 ? "Adding…" : "Add"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
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
