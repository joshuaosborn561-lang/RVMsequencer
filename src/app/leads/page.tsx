"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import type { CampaignRecord, LeadRecord } from "@/lib/store/types";

type Row = LeadRecord & { campaignName: string };

export default function AllLeadsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("ALL");

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/campaigns");
      const data = (await res.json()) as { campaigns: CampaignRecord[] };
      const all: Row[] = [];
      for (const c of data.campaigns) {
        const lr = await fetch(`/api/campaigns/${c.id}`);
        const ld = (await lr.json()) as { leads?: LeadRecord[] };
        for (const l of ld.leads ?? []) {
          all.push({ ...l, campaignName: c.name });
        }
      }
      setRows(all);
    })();
  }, []);

  const visible = rows.filter((l) => {
    if (status !== "ALL" && (l.status ?? "PENDING") !== status) return false;
    if (!q.trim()) return true;
    const hay = `${l.phoneE164} ${l.firstName ?? ""} ${l.lastName ?? ""} ${l.company ?? ""} ${l.campaignName}`.toLowerCase();
    return hay.includes(q.trim().toLowerCase());
  });

  return (
    <AppShell
      title="All Leads"
      subtitle="Cross-campaign lead store — Smartlead All Leads equivalent for phone prospects."
      actions={
        <Link href="/campaigns" className="sl-btn sl-btn-primary">
          + Add via Campaign
        </Link>
      }
    >
      <div className="sl-toolbar">
        <select
          className="sl-input"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="ALL">All statuses</option>
          <option value="PENDING">Pending</option>
          <option value="SENDING">Sending</option>
          <option value="SENT">Sent</option>
          <option value="FAILED">Failed</option>
          <option value="SUPPRESSED">Suppressed</option>
        </select>
        <input
          className="sl-input min-w-[220px]"
          placeholder="Search phone, name, campaign…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <span className="text-xs text-[var(--muted)]">{visible.length} leads</span>
      </div>

      <div className="sl-table-wrap">
        <table className="w-full text-left text-sm">
          <thead className="bg-[var(--bg)] text-[11px] uppercase tracking-wider text-[var(--muted)]">
            <tr>
              <th className="px-4 py-3 font-medium">Phone</th>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Company</th>
              <th className="px-4 py-3 font-medium">Campaign</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Step</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-[var(--muted)]">
                  No leads yet. Open a campaign → Leads → + Add Leads (CSV).
                </td>
              </tr>
            ) : (
              visible.slice(0, 200).map((l) => (
                <tr key={l.id} className="border-t border-[var(--line)]">
                  <td className="px-4 py-3 font-[family-name:var(--font-mono)]">
                    {l.phoneE164}
                  </td>
                  <td className="px-4 py-3">
                    {[l.firstName, l.lastName].filter(Boolean).join(" ") || "—"}
                  </td>
                  <td className="px-4 py-3">{l.company ?? "—"}</td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/campaigns/${l.campaignId}?tab=leads`}
                      className="text-[var(--accent)] hover:underline"
                    >
                      {l.campaignName}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <span className="badge badge-muted">
                      {l.status ?? "PENDING"}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-[family-name:var(--font-mono)]">
                    {l.currentStepPosition ?? "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
