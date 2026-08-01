"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { guessFieldMapping, parseCsv } from "@/lib/csv";
import type { CampaignRecord, LeadRecord } from "@/lib/store/types";

type Tab =
  | "leads"
  | "sequence"
  | "lines"
  | "schedule"
  | "preview"
  | "launch";

const TABS: { id: Tab; label: string }[] = [
  { id: "leads", label: "Leads / CSV" },
  { id: "sequence", label: "Sequence" },
  { id: "lines", label: "Lines & CID" },
  { id: "schedule", label: "Schedule" },
  { id: "preview", label: "Preview" },
  { id: "launch", label: "Launch" },
];

export default function CampaignWizardPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [tab, setTab] = useState<Tab>("leads");
  const [campaign, setCampaign] = useState<CampaignRecord | null>(null);
  const [leads, setLeads] = useState<LeadRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/campaigns/${id}`);
    if (res.ok) {
      const data = (await res.json()) as {
        campaign: CampaignRecord;
        leads: LeadRecord[];
      };
      setCampaign(data.campaign);
      setLeads(data.leads ?? []);
    } else {
      setCampaign(null);
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function patch(body: Partial<CampaignRecord>) {
    const res = await fetch(`/api/campaigns/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      setMsg(await res.text());
      return;
    }
    const data = (await res.json()) as { campaign: CampaignRecord };
    setCampaign(data.campaign);
    setMsg("Saved");
  }

  if (loading) {
    return (
      <AppShell title="Campaign" subtitle="Loading…">
        <p className="text-sm text-[var(--muted)]">Loading campaign…</p>
      </AppShell>
    );
  }

  if (!campaign) {
    return (
      <AppShell title="Campaign" subtitle="Not found">
        <p className="text-sm text-[var(--muted)]">
          Campaign not found.{" "}
          <Link href="/campaigns" className="text-[var(--accent)] underline">
            Back to campaigns
          </Link>
        </p>
      </AppShell>
    );
  }

  return (
    <AppShell
      title={campaign.name}
      subtitle={`${campaign.status} · ${leads.length} leads · client ${campaign.clientId ?? "—"}`}
    >
      <div className="mb-6 flex flex-wrap gap-1 border-b border-[var(--line)] pb-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`rounded-lg px-3 py-2 text-sm transition ${
              tab === t.id
                ? "bg-[var(--accent-soft)] font-medium text-[var(--accent)]"
                : "text-[var(--muted)] hover:bg-white hover:text-[var(--ink)]"
            }`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {msg ? <p className="mb-4 text-sm text-[var(--muted)]">{msg}</p> : null}

      {tab === "leads" ? (
        <LeadsTab
          campaignId={id}
          leads={leads}
          onImported={() => void reload()}
        />
      ) : null}
      {tab === "sequence" ? (
        <SequenceTab campaign={campaign} onSave={patch} />
      ) : null}
      {tab === "lines" ? <LinesTab campaign={campaign} onSave={patch} /> : null}
      {tab === "schedule" ? (
        <ScheduleTab campaign={campaign} onSave={patch} />
      ) : null}
      {tab === "preview" ? (
        <PreviewTab campaignId={id} leads={leads} />
      ) : null}
      {tab === "launch" ? (
        <LaunchTab
          campaign={campaign}
          leadCount={leads.length}
          onSave={patch}
        />
      ) : null}
    </AppShell>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="text-[var(--muted)]">{label}</span>
      {children}
    </label>
  );
}

const inputClass =
  "rounded-lg border border-[var(--line)] bg-white px-3 py-2 text-sm";

function LeadsTab({
  campaignId,
  leads,
  onImported,
}: {
  campaignId: string;
  leads: LeadRecord[];
  onImported: () => void;
}) {
  const [raw, setRaw] = useState(
    "phone,first_name,company\n4155550100,Alex,Acme\n6465550199,Sam,Northwind",
  );
  const [mapping, setMapping] = useState<Record<string, string>>({
    phone: "phone",
    first_name: "first_name",
    last_name: "last_name",
    company: "company",
    email: "email",
  });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function onFile(file: File) {
    const text = await file.text();
    setRaw(text);
    const { headers } = parseCsv(text);
    const guessed = guessFieldMapping(headers);
    const next: Record<string, string> = {
      phone: "",
      first_name: "",
      last_name: "",
      company: "",
      email: "",
    };
    for (const [header, role] of Object.entries(guessed)) {
      if (role.startsWith("custom:")) continue;
      next[role] = header;
    }
    setMapping((m) => ({ ...m, ...next }));
  }

  async function importCsv() {
    setBusy(true);
    setResult(null);
    const res = await fetch(`/api/campaigns/${campaignId}/leads`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        csv: raw,
        mapping: {
          phone: mapping.phone || "phone",
          firstName: mapping.first_name || undefined,
          lastName: mapping.last_name || undefined,
          company: mapping.company || undefined,
          email: mapping.email || undefined,
        },
      }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setResult(
        typeof data.error === "string"
          ? data.error
          : "Import failed — check CSV + phone column",
      );
      return;
    }
    setResult(
      `Imported ${data.imported}. Skipped ${data.skipped}. DNC hits ${data.dncHits ?? 0}.`,
    );
    onImported();
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="panel rounded-xl p-5">
        <h2 className="font-[family-name:var(--font-display)] text-xl">
          Import CSV
        </h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Upload → map columns → scrub DNC → import. Extra columns become{" "}
          {"{{variables}}"}.
        </p>
        <div className="mt-4 flex flex-col gap-4">
          <Field label="CSV file">
            <input
              type="file"
              accept=".csv,text/csv"
              className={inputClass}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onFile(f);
              }}
            />
          </Field>
          <Field label="Or paste CSV">
            <textarea
              rows={8}
              className={`${inputClass} font-[family-name:var(--font-mono)]`}
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            {(
              [
                ["phone", "Phone column *"],
                ["first_name", "First name"],
                ["last_name", "Last name"],
                ["company", "Company"],
                ["email", "Email"],
              ] as const
            ).map(([key, label]) => (
              <Field key={key} label={label}>
                <input
                  className={inputClass}
                  value={mapping[key] ?? ""}
                  onChange={(e) =>
                    setMapping((m) => ({ ...m, [key]: e.target.value }))
                  }
                  placeholder="CSV header name"
                />
              </Field>
            ))}
          </div>
          <button
            type="button"
            className="w-fit rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            disabled={busy}
            onClick={() => void importCsv()}
          >
            {busy ? "Importing…" : "Import + DNC scrub"}
          </button>
          {result ? (
            <p className="text-sm text-[var(--muted)]">{result}</p>
          ) : null}
        </div>
      </section>

      <section className="panel overflow-hidden rounded-xl">
        <div className="border-b border-[var(--line)] px-5 py-4">
          <h2 className="font-[family-name:var(--font-display)] text-xl">
            Leads ({leads.length})
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-white/60 text-xs uppercase tracking-wider text-[var(--muted)]">
              <tr>
                <th className="px-4 py-3 font-medium">Phone</th>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Company</th>
                <th className="px-4 py-3 font-medium">DNC</th>
                <th className="px-4 py-3 font-medium">Vars</th>
              </tr>
            </thead>
            <tbody>
              {leads.slice(0, 50).map((l) => (
                <tr key={l.id} className="border-t border-[var(--line)]">
                  <td className="px-4 py-3 font-[family-name:var(--font-mono)]">
                    {l.phoneE164}
                  </td>
                  <td className="px-4 py-3">
                    {[l.firstName, l.lastName].filter(Boolean).join(" ") || "—"}
                  </td>
                  <td className="px-4 py-3">{l.company ?? "—"}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`badge ${l.dnc ? "badge-danger" : "badge-ok"}`}
                    >
                      {l.dnc ? "DNC" : "OK"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[var(--muted)]">
                    {Object.keys(l.custom).join(", ") || "—"}
                  </td>
                </tr>
              ))}
              {leads.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-8 text-center text-[var(--muted)]"
                  >
                    No leads yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function SequenceTab({
  campaign,
  onSave,
}: {
  campaign: CampaignRecord;
  onSave: (body: Partial<CampaignRecord>) => Promise<void>;
}) {
  const step = campaign.steps[0];
  const [script, setScript] = useState(step?.scriptTemplate ?? "");
  const [delay, setDelay] = useState(String(step?.delayDays ?? 0));

  useEffect(() => {
    setScript(step?.scriptTemplate ?? "");
    setDelay(String(step?.delayDays ?? 0));
  }, [step?.scriptTemplate, step?.delayDays]);

  return (
    <section className="panel rounded-xl p-5">
      <h2 className="font-[family-name:var(--font-display)] text-xl">
        Sequence step 1 — RVM
      </h2>
      <p className="mt-1 text-sm text-[var(--muted)]">
        Variables: {"{{first_name}}"}, {"{{last_name}}"}, {"{{company}}"},{" "}
        {"{{phone}}"}, plus any custom CSV columns.
      </p>
      <div className="mt-4 flex flex-col gap-4">
        <Field label="Script template">
          <textarea
            rows={6}
            className={inputClass}
            value={script}
            onChange={(e) => setScript(e.target.value)}
          />
        </Field>
        <Field label="Delay before send (days)">
          <input
            className={inputClass}
            value={delay}
            onChange={(e) => setDelay(e.target.value)}
          />
        </Field>
        <button
          type="button"
          className="w-fit rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white"
          onClick={() =>
            void onSave({
              steps: [
                {
                  id: step?.id ?? "step_1",
                  position: 1,
                  delayDays: Number(delay) || 0,
                  scriptTemplate: script,
                  voiceId: step?.voiceId,
                  audioUrl: step?.audioUrl,
                },
                ...campaign.steps.filter((s) => s.position !== 1),
              ],
            })
          }
        >
          Save sequence
        </button>
      </div>
    </section>
  );
}

function LinesTab({
  campaign,
  onSave,
}: {
  campaign: CampaignRecord;
  onSave: (body: Partial<CampaignRecord>) => Promise<void>;
}) {
  const [pool, setPool] = useState(campaign.lineIds.join(", "));

  useEffect(() => {
    setPool(campaign.lineIds.join(", "));
  }, [campaign.lineIds]);

  return (
    <section className="panel rounded-xl p-5">
      <h2 className="font-[family-name:var(--font-display)] text-xl">
        Lines & caller ID pool
      </h2>
      <p className="mt-1 text-sm text-[var(--muted)]">
        Comma-separated E.164 numbers (or line IDs). Warmup + daily caps apply
        at send time — same role as Smartlead mailboxes.
      </p>
      <div className="mt-4 flex flex-col gap-4">
        <Field label="Line pool">
          <textarea
            rows={3}
            className={`${inputClass} font-[family-name:var(--font-mono)]`}
            value={pool}
            onChange={(e) => setPool(e.target.value)}
            placeholder="+14155550101, +14155550102"
          />
        </Field>
        <button
          type="button"
          className="w-fit rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white"
          onClick={() =>
            void onSave({
              lineIds: pool
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
            })
          }
        >
          Save lines
        </button>
      </div>
    </section>
  );
}

function ScheduleTab({
  campaign,
  onSave,
}: {
  campaign: CampaignRecord;
  onSave: (body: Partial<CampaignRecord>) => Promise<void>;
}) {
  const s = campaign.schedule;
  const [start, setStart] = useState(String(s.sendWindowStart));
  const [end, setEnd] = useState(String(s.sendWindowEnd));
  const [tz, setTz] = useState(s.timezoneMode);
  const [perDay, setPerDay] = useState(String(s.newLeadsPerDay));
  const [days, setDays] = useState(s.sendDays.join(","));

  useEffect(() => {
    setStart(String(s.sendWindowStart));
    setEnd(String(s.sendWindowEnd));
    setTz(s.timezoneMode);
    setPerDay(String(s.newLeadsPerDay));
    setDays(s.sendDays.join(","));
  }, [s]);

  return (
    <section className="panel rounded-xl p-5">
      <h2 className="font-[family-name:var(--font-display)] text-xl">
        Campaign settings / schedule
      </h2>
      <p className="mt-1 text-sm text-[var(--muted)]">
        Recipient-local time from phone NPA. Hard gate before every drop.
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field label="Start hour (local)">
          <input
            className={inputClass}
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </Field>
        <Field label="End hour (local, exclusive)">
          <input
            className={inputClass}
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
        </Field>
        <Field label="Send days (0=Sun … 6=Sat)">
          <input
            className={inputClass}
            value={days}
            onChange={(e) => setDays(e.target.value)}
          />
        </Field>
        <Field label="New leads / day">
          <input
            className={inputClass}
            value={perDay}
            onChange={(e) => setPerDay(e.target.value)}
          />
        </Field>
        <Field label="Timezone mode">
          <select
            className={inputClass}
            value={tz}
            onChange={(e) =>
              setTz(e.target.value as CampaignRecord["schedule"]["timezoneMode"])
            }
          >
            <option value="RECIPIENT_LOCAL">Recipient local (recommended)</option>
            <option value="FIXED">Fixed timezone</option>
          </select>
        </Field>
      </div>
      <button
        type="button"
        className="mt-4 w-fit rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white"
        onClick={() =>
          void onSave({
            schedule: {
              ...campaign.schedule,
              sendWindowStart: Number(start) || 9,
              sendWindowEnd: Number(end) || 20,
              timezoneMode: tz,
              newLeadsPerDay: Number(perDay) || 200,
              sendDays: days
                .split(",")
                .map((d) => Number(d.trim()))
                .filter((n) => n >= 0 && n <= 6),
            },
          })
        }
      >
        Save schedule
      </button>
    </section>
  );
}

function PreviewTab({
  campaignId,
  leads,
}: {
  campaignId: string;
  leads: LeadRecord[];
}) {
  const [leadId, setLeadId] = useState(leads[0]?.id ?? "");
  const [preview, setPreview] = useState<{
    rendered: string;
    variables: Record<string, string>;
    timezone: string | null;
    inWindow: boolean;
    reason?: string;
  } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!leadId && leads[0]) setLeadId(leads[0].id);
  }, [leads, leadId]);

  const leadOptions = useMemo(() => leads.slice(0, 100), [leads]);

  async function run() {
    setErr(null);
    const res = await fetch(`/api/campaigns/${campaignId}/preview`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ leadId: leadId || undefined }),
    });
    const data = await res.json();
    if (!res.ok) {
      setErr(data.error ?? "Preview failed");
      setPreview(null);
      return;
    }
    setPreview({
      rendered: data.rendered,
      variables: data.variables,
      timezone: data.timezone ?? null,
      inWindow: Boolean(data.inWindow),
      reason: data.reason,
    });
  }

  return (
    <section className="panel rounded-xl p-5">
      <h2 className="font-[family-name:var(--font-display)] text-xl">
        Preview send
      </h2>
      <p className="mt-1 text-sm text-[var(--muted)]">
        Renders merge variables and checks the local send window for a sample
        lead.
      </p>
      <div className="mt-4 flex flex-col gap-4">
        <Field label="Lead">
          <select
            className={inputClass}
            value={leadId}
            onChange={(e) => setLeadId(e.target.value)}
          >
            {leadOptions.map((l) => (
              <option key={l.id} value={l.id}>
                {l.phoneE164} — {l.firstName ?? ""} {l.company ?? ""}
              </option>
            ))}
          </select>
        </Field>
        <button
          type="button"
          className="w-fit rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white"
          onClick={() => void run()}
          disabled={leads.length === 0}
        >
          Preview
        </button>
        {err ? <p className="text-sm text-[var(--danger)]">{err}</p> : null}
        {preview ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm">
              TZ: <strong>{preview.timezone ?? "unknown"}</strong> · In window:{" "}
              <strong>{preview.inWindow ? "yes" : "no"}</strong>
              {preview.reason ? (
                <span className="text-[var(--muted)]"> ({preview.reason})</span>
              ) : null}
            </p>
            <pre className="overflow-x-auto rounded-lg border border-[var(--line)] bg-white/80 p-3 text-sm whitespace-pre-wrap">
              {preview.rendered}
            </pre>
            <pre className="overflow-x-auto rounded-lg border border-[var(--line)] bg-white/80 p-3 font-[family-name:var(--font-mono)] text-xs">
              {JSON.stringify(preview.variables, null, 2)}
            </pre>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function LaunchTab({
  campaign,
  leadCount,
  onSave,
}: {
  campaign: CampaignRecord;
  leadCount: number;
  onSave: (body: Partial<CampaignRecord>) => Promise<void>;
}) {
  return (
    <section className="panel rounded-xl p-5">
      <h2 className="font-[family-name:var(--font-display)] text-xl">Launch</h2>
      <p className="mt-1 text-sm text-[var(--muted)]">
        {leadCount} leads loaded. Status: <strong>{campaign.status}</strong>.
        Cron should hit <code className="text-xs">POST /api/sequencer/tick</code>{" "}
        every minute while ACTIVE — see Go live.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        {campaign.status !== "ACTIVE" ? (
          <button
            type="button"
            className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white"
            onClick={() => void onSave({ status: "ACTIVE" })}
            disabled={leadCount === 0}
          >
            Start campaign
          </button>
        ) : (
          <button
            type="button"
            className="rounded-lg border border-[var(--line)] bg-white px-4 py-2 text-sm"
            onClick={() => void onSave({ status: "PAUSED" })}
          >
            Pause
          </button>
        )}
        <button
          type="button"
          className="rounded-lg border border-[var(--line)] bg-white px-4 py-2 text-sm"
          onClick={() => void onSave({ status: "DRAFT" })}
        >
          Back to draft
        </button>
      </div>
    </section>
  );
}
