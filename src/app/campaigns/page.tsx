"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import type { CampaignRecord } from "@/lib/store/types";

export default function CampaignsPage() {
  const router = useRouter();
  const [campaigns, setCampaigns] = useState<CampaignRecord[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const res = await fetch("/api/campaigns");
    const data = (await res.json()) as { campaigns: CampaignRecord[] };
    setCampaigns(data.campaigns);
  }

  useEffect(() => {
    void load();
  }, []);

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
    router.push(`/campaigns/${data.campaign.id}`);
  }

  return (
    <AppShell
      title="Campaigns"
      subtitle="Smartlead-style RVM campaigns — CSV → variables → sequence → schedule → launch."
      actions={
        <div className="flex gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="New campaign name"
            className="rounded-lg border border-[var(--line)] bg-white px-3 py-2 text-sm"
          />
          <button
            type="button"
            disabled={busy || !name.trim()}
            onClick={() => void create()}
            className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            Create
          </button>
        </div>
      }
    >
      <div className="panel overflow-hidden rounded-xl">
        <table className="w-full text-left text-sm">
          <thead className="bg-white/60 text-xs uppercase tracking-wider text-[var(--muted)]">
            <tr>
              <th className="px-4 py-3 font-medium">Campaign</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Steps</th>
              <th className="px-4 py-3 font-medium">Updated</th>
            </tr>
          </thead>
          <tbody>
            {campaigns.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-[var(--muted)]">
                  No campaigns yet — create one to open the wizard.
                </td>
              </tr>
            ) : (
              campaigns.map((c) => (
                <tr key={c.id} className="border-t border-[var(--line)]">
                  <td className="px-4 py-3">
                    <Link
                      href={`/campaigns/${c.id}`}
                      className="font-medium text-[var(--accent)] hover:underline"
                    >
                      {c.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`badge ${
                        c.status === "ACTIVE"
                          ? "badge-ok"
                          : c.status === "DRAFT"
                            ? "badge-muted"
                            : "badge-warn"
                      }`}
                    >
                      {c.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-[family-name:var(--font-mono)]">
                    {c.steps.length}
                  </td>
                  <td className="px-4 py-3 text-[var(--muted)]">
                    {new Date(c.updatedAt).toLocaleString()}
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
