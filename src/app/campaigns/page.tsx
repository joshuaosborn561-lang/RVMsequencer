"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import type { CampaignRecord, LeadRecord } from "@/lib/store/types";

type Row = CampaignRecord & {
  leads: number;
  sent: number;
  pending: number;
  failed: number;
  suppressed: number;
};

export default function CampaignsPage() {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([]);
  const [view, setView] = useState<"all" | "folders">("all");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [q, setQ] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const res = await fetch("/api/campaigns");
    const data = (await res.json()) as { campaigns: CampaignRecord[] };
    const withStats = await Promise.all(
      data.campaigns.map(async (c) => {
        const lr = await fetch(`/api/campaigns/${c.id}`);
        const ld = (await lr.json()) as { leads?: LeadRecord[] };
        const leads = ld.leads ?? [];
        return {
          ...c,
          leads: leads.length,
          sent: leads.filter((l) => l.status === "SENT").length,
          pending: leads.filter(
            (l) => (l.status ?? "PENDING") === "PENDING" || l.status === "FAILED",
          ).length,
          failed: leads.filter((l) => l.status === "FAILED").length,
          suppressed: leads.filter((l) => l.status === "SUPPRESSED" || l.dnc)
            .length,
        };
      }),
    );
    setRows(withStats);
  }

  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(() => {
    return rows.filter((c) => {
      if (statusFilter !== "ALL" && c.status !== statusFilter) return false;
      if (q.trim() && !c.name.toLowerCase().includes(q.trim().toLowerCase())) {
        return false;
      }
      return true;
    });
  }, [rows, statusFilter, q]);

  async function create() {
    if (!name.trim()) return;
    setBusy(true);
    const res = await fetch("/api/campaigns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), clientId: "client_demo" }),
    });
    const data = (await res.json()) as { campaign: CampaignRecord };
    setBusy(false);
    setShowCreate(false);
    router.push(`/campaigns/${data.campaign.id}?tab=leads`);
  }

  return (
    <AppShell title="Campaigns">
      <div className="sl-tabs">
        <button
          type="button"
          className={`sl-tab ${view === "all" ? "sl-tab-active" : ""}`}
          onClick={() => setView("all")}
        >
          All Campaigns
        </button>
        <button
          type="button"
          className={`sl-tab ${view === "folders" ? "sl-tab-active" : ""}`}
          onClick={() => setView("folders")}
        >
          Folders
        </button>
      </div>

      <div className="sl-toolbar justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="sl-input"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            aria-label="Filter by status"
          >
            <option value="ALL">All statuses</option>
            <option value="DRAFT">Draft</option>
            <option value="ACTIVE">Active</option>
            <option value="PAUSED">Paused</option>
            <option value="COMPLETED">Completed</option>
            <option value="ARCHIVED">Archived</option>
          </select>
          <input
            className="sl-input min-w-[200px]"
            placeholder="Search campaigns…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <button
          type="button"
          className="sl-btn sl-btn-primary"
          onClick={() => setShowCreate(true)}
        >
          + Create Campaign
        </button>
      </div>

      {view === "folders" ? (
        <div className="sl-table-wrap p-8 text-center text-sm text-[var(--muted)]">
          Folders group campaigns by client or offer. Assign a client on the
          campaign Settings tab — Client Access lives in the sidebar.
        </div>
      ) : (
        <div className="sl-table-wrap">
          <table className="w-full text-left text-sm">
            <thead className="bg-[var(--bg)] text-[11px] uppercase tracking-wider text-[var(--muted)]">
              <tr>
                <th className="px-4 py-3 font-medium">Campaign</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Leads</th>
                <th className="px-4 py-3 font-medium">Sent</th>
                <th className="px-4 py-3 font-medium">Pending</th>
                <th className="px-4 py-3 font-medium">Failed</th>
                <th className="px-4 py-3 font-medium">Suppressed</th>
                <th className="px-4 py-3 font-medium">Steps</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    className="px-4 py-12 text-center text-[var(--muted)]"
                  >
                    No campaigns yet. Click{" "}
                    <strong>+ Create Campaign</strong> to start — same flow as
                    Smartlead: Leads → Sequence → Phone Lines → Settings →
                    Launch.
                  </td>
                </tr>
              ) : (
                filtered.map((c) => (
                  <tr
                    key={c.id}
                    className="border-t border-[var(--line)] hover:bg-[var(--bg)]/60"
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/campaigns/${c.id}`}
                        className="font-medium text-[var(--accent)] hover:underline"
                      >
                        {c.name}
                      </Link>
                      <p className="text-[11px] text-[var(--muted)]">
                        {c.clientId ?? "No client"}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`badge ${
                          c.status === "ACTIVE"
                            ? "badge-ok"
                            : c.status === "DRAFT"
                              ? "badge-muted"
                              : c.status === "PAUSED"
                                ? "badge-warn"
                                : "badge-muted"
                        }`}
                      >
                        {c.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-[family-name:var(--font-mono)]">
                      {c.leads}
                    </td>
                    <td className="px-4 py-3 font-[family-name:var(--font-mono)]">
                      {c.sent}
                    </td>
                    <td className="px-4 py-3 font-[family-name:var(--font-mono)]">
                      {c.pending}
                    </td>
                    <td className="px-4 py-3 font-[family-name:var(--font-mono)]">
                      {c.failed}
                    </td>
                    <td className="px-4 py-3 font-[family-name:var(--font-mono)]">
                      {c.suppressed}
                    </td>
                    <td className="px-4 py-3 font-[family-name:var(--font-mono)]">
                      {c.steps.length}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {showCreate ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-md rounded-xl border border-[var(--line)] bg-white p-5 shadow-lg">
            <h2 className="font-[family-name:var(--font-display)] text-xl">
              Create Campaign
            </h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Opens in Draft — configure Leads, Sequence, Phone Lines, then
              Launch.
            </p>
            <label className="mt-4 flex flex-col gap-1.5 text-sm">
              <span className="text-[var(--muted)]">Campaign name</span>
              <input
                className="sl-input"
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Q3 RVM — HVAC owners"
                onKeyDown={(e) => {
                  if (e.key === "Enter") void create();
                }}
              />
            </label>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                className="sl-btn sl-btn-ghost"
                onClick={() => setShowCreate(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="sl-btn sl-btn-primary"
                disabled={busy || !name.trim()}
                onClick={() => void create()}
              >
                {busy ? "Creating…" : "Continue"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </AppShell>
  );
}
