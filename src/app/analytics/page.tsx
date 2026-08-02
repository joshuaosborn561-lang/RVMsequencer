"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import type { CampaignRecord, LeadRecord } from "@/lib/store/types";

export default function AnalyticsPage() {
  const [stats, setStats] = useState({
    campaigns: 0,
    active: 0,
    leads: 0,
    sent: 0,
    pending: 0,
    suppressed: 0,
    failed: 0,
  });
  const [rows, setRows] = useState<
    Array<CampaignRecord & { sent: number; leads: number }>
  >([]);

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/campaigns");
      const data = (await res.json()) as { campaigns: CampaignRecord[] };
      let leads = 0;
      let sent = 0;
      let pending = 0;
      let suppressed = 0;
      let failed = 0;
      const detail = [];
      for (const c of data.campaigns) {
        const lr = await fetch(`/api/campaigns/${c.id}`);
        const ld = (await lr.json()) as { leads?: LeadRecord[] };
        const list = ld.leads ?? [];
        leads += list.length;
        const s = list.filter((l) => l.status === "SENT").length;
        sent += s;
        pending += list.filter(
          (l) => (l.status ?? "PENDING") === "PENDING" || l.status === "FAILED",
        ).length;
        suppressed += list.filter(
          (l) => l.status === "SUPPRESSED" || l.dnc,
        ).length;
        failed += list.filter((l) => l.status === "FAILED").length;
        detail.push({ ...c, sent: s, leads: list.length });
      }
      setStats({
        campaigns: data.campaigns.length,
        active: data.campaigns.filter((c) => c.status === "ACTIVE").length,
        leads,
        sent,
        pending,
        suppressed,
        failed,
      });
      setRows(detail);
    })();
  }, []);

  const cards = [
    { label: "Campaigns", value: stats.campaigns },
    { label: "Active", value: stats.active },
    { label: "Leads", value: stats.leads },
    { label: "Sent (RVM)", value: stats.sent },
    { label: "Pending", value: stats.pending },
    { label: "Suppressed", value: stats.suppressed },
  ];

  return (
    <AppShell
      title="Global Analytics"
      subtitle="Account-wide KPIs across campaigns — Smartlead Global Analytics equivalent for RVM drops."
    >
      <section className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {cards.map((c) => (
          <div key={c.label} className="rounded-xl border border-[var(--line)] bg-white p-4">
            <p className="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">
              {c.label}
            </p>
            <p className="mt-1 font-[family-name:var(--font-display)] text-2xl">
              {c.value}
            </p>
          </div>
        ))}
      </section>

      <div className="sl-table-wrap mt-6">
        <div className="border-b border-[var(--line)] px-4 py-3 text-sm font-medium">
          Campaign activity
        </div>
        <table className="w-full text-left text-sm">
          <thead className="bg-[var(--bg)] text-[11px] uppercase tracking-wider text-[var(--muted)]">
            <tr>
              <th className="px-4 py-3 font-medium">Campaign</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Leads</th>
              <th className="px-4 py-3 font-medium">Sent</th>
              <th className="px-4 py-3 font-medium">Last drain</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-[var(--muted)]">
                  No campaign data yet.
                </td>
              </tr>
            ) : (
              rows.map((c) => (
                <tr key={c.id} className="border-t border-[var(--line)]">
                  <td className="px-4 py-3">
                    <Link
                      href={`/campaigns/${c.id}?tab=analytics`}
                      className="text-[var(--accent)] hover:underline"
                    >
                      {c.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <span className="badge badge-muted">{c.status}</span>
                  </td>
                  <td className="px-4 py-3 font-[family-name:var(--font-mono)]">
                    {c.leads}
                  </td>
                  <td className="px-4 py-3 font-[family-name:var(--font-mono)]">
                    {c.sent}
                  </td>
                  <td className="px-4 py-3 text-[var(--muted)]">
                    {c.lastDrainAt
                      ? new Date(c.lastDrainAt).toLocaleString()
                      : "—"}
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
