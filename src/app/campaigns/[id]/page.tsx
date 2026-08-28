"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { guessFieldMapping, parseCsv } from "@/lib/csv";
import type { CampaignRecord, LeadRecord } from "@/lib/store/types";

/** Smartlead campaign tabs: Analytics → Leads → Sequence → Accounts → Settings → Launch */
type Tab =
  | "analytics"
  | "leads"
  | "sequence"
  | "accounts"
  | "settings"
  | "launch";

const TABS: { id: Tab; label: string }[] = [
  { id: "analytics", label: "Analytics" },
  { id: "leads", label: "Leads" },
  { id: "sequence", label: "Sequence" },
  { id: "accounts", label: "Phone Lines" },
  { id: "settings", label: "Settings" },
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
  const [editName, setEditName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");

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
      setNameDraft(data.campaign.name);
    } else {
      setCampaign(null);
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab") as Tab | null;
    if (t && TABS.some((x) => x.id === t)) setTab(t);
  }, []);

  async function patch(body: Partial<CampaignRecord>) {
    setMsg(null);
    const res = await fetch(`/api/campaigns/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      const blockers = Array.isArray(data.blockers)
        ? data.blockers.join(", ")
        : null;
      setMsg(
        blockers
          ? `Blocked: ${blockers}. ${data.hint ?? ""}`
          : data.hint ?? data.error ?? "Save failed",
      );
      return;
    }
    setCampaign(data.campaign as CampaignRecord);
    setMsg("Saved");
    window.setTimeout(() => setMsg(null), 2500);
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

  const sendable = leads.filter((l) => {
    const s = l.status ?? "PENDING";
    return (
      !l.dnc &&
      l.consentStatus !== "OPTED_OUT" &&
      s !== "SUPPRESSED" &&
      s !== "SENT"
    );
  }).length;

  return (
    <AppShell bare>
      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-sm text-[var(--muted)]">
            <Link href="/campaigns" className="hover:text-[var(--accent)]">
              Campaigns
            </Link>
            <span>/</span>
            <span className="badge badge-muted">{campaign.status}</span>
          </div>
          {editName ? (
            <div className="mt-1 flex gap-2">
              <input
                className="sl-input min-w-[220px]"
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
              />
              <button
                type="button"
                className="sl-btn sl-btn-primary"
                onClick={() => {
                  void patch({ name: nameDraft.trim() || campaign.name });
                  setEditName(false);
                }}
              >
                Save
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="mt-1 text-left font-[family-name:var(--font-display)] text-2xl tracking-tight hover:text-[var(--accent)]"
              onClick={() => setEditName(true)}
              title="Rename campaign"
            >
              {campaign.name}
            </button>
          )}
          <p className="mt-0.5 text-sm text-[var(--muted)]">
            {sendable} sendable · {leads.length} leads · client{" "}
            {campaign.clientId ?? "—"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {campaign.status === "ACTIVE" ? (
            <button
              type="button"
              className="sl-btn sl-btn-ghost"
              onClick={() => void patch({ status: "PAUSED" })}
            >
              Pause
            </button>
          ) : (
            <button
              type="button"
              className="sl-btn sl-btn-primary"
              onClick={() => setTab("launch")}
            >
              Launch Campaign
            </button>
          )}
        </div>
      </div>

      <div className="sl-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`sl-tab ${tab === t.id ? "sl-tab-active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {msg ? <p className="mb-3 text-sm text-[var(--muted)]">{msg}</p> : null}

      {tab === "analytics" ? (
        <AnalyticsTab campaign={campaign} leads={leads} />
      ) : null}
      {tab === "leads" ? (
        <LeadsTab
          campaignId={id}
          leads={leads}
          onImported={() => void reload()}
          onNext={() => setTab("sequence")}
        />
      ) : null}
      {tab === "sequence" ? (
        <SequenceTab
          campaign={campaign}
          onSave={patch}
          onNext={() => setTab("accounts")}
        />
      ) : null}
      {tab === "accounts" ? (
        <LinesTab
          campaign={campaign}
          onSave={patch}
          onNext={() => setTab("settings")}
        />
      ) : null}
      {tab === "settings" ? (
        <ScheduleTab
          campaign={campaign}
          onSave={patch}
          onNext={() => setTab("launch")}
        />
      ) : null}
      {tab === "launch" ? (
        <div className="flex flex-col gap-6">
          <LaunchTab campaign={campaign} leads={leads} onSave={patch} />
          <PreviewTab campaignId={id} leads={leads} />
        </div>
      ) : null}
    </AppShell>
  );
}

function AnalyticsTab({
  campaign,
  leads,
}: {
  campaign: CampaignRecord;
  leads: LeadRecord[];
}) {
  const sent = leads.filter((l) => l.status === "SENT").length;
  const pending = leads.filter(
    (l) => (l.status ?? "PENDING") === "PENDING" || l.status === "SENDING",
  ).length;
  const failed = leads.filter((l) => l.status === "FAILED").length;
  const suppressed = leads.filter(
    (l) => l.status === "SUPPRESSED" || l.dnc,
  ).length;
  const cards = [
    { label: "Leads", value: leads.length },
    { label: "RVM sent", value: sent },
    { label: "Pending", value: pending },
    { label: "Failed", value: failed },
    { label: "Suppressed", value: suppressed },
    {
      label: "Completion",
      value:
        leads.length === 0
          ? "—"
          : `${Math.round((sent / leads.length) * 100)}%`,
    },
  ];
  return (
    <div className="flex flex-col gap-6">
      <section className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {cards.map((c) => (
          <div
            key={c.label}
            className="rounded-xl border border-[var(--line)] bg-white p-4"
          >
            <p className="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">
              {c.label}
            </p>
            <p className="mt-1 font-[family-name:var(--font-display)] text-2xl">
              {c.value}
            </p>
          </div>
        ))}
      </section>
      <section className="rounded-xl border border-[var(--line)] bg-white p-5">
        <h2 className="font-[family-name:var(--font-display)] text-lg">
          Campaign health
        </h2>
        <ul className="mt-3 space-y-1 text-sm text-[var(--muted)]">
          <li>
            Status: <strong className="text-[var(--ink)]">{campaign.status}</strong>
          </li>
          <li>
            Schedule: {campaign.schedule.sendWindowStart}:00–
            {campaign.schedule.sendWindowEnd}:00 ·{" "}
            {campaign.schedule.timezoneMode}
          </li>
          <li>Phone lines assigned: {campaign.lineIds.length}</li>
          <li>Sequence steps: {campaign.steps.length}</li>
          {campaign.lastDrainAt ? (
            <li>
              Last drain {new Date(campaign.lastDrainAt).toLocaleString()} — sent{" "}
              {campaign.lastDrainStats?.sent ?? 0}, skipped{" "}
              {campaign.lastDrainStats?.skipped ?? 0}, failed{" "}
              {campaign.lastDrainStats?.failed ?? 0}
            </li>
          ) : (
            <li>No drain yet — launch when setup is complete.</li>
          )}
          {campaign.lastError ? (
            <li className="text-[var(--danger)]">Last error: {campaign.lastError}</li>
          ) : null}
        </ul>
      </section>
    </div>
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
  onNext,
}: {
  campaignId: string;
  leads: LeadRecord[];
  onImported: () => void;
  onNext: () => void;
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
  const [mode, setMode] = useState<"append" | "replace">("append");

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
        mode,
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
      `${mode === "replace" ? "Replaced then i" : "I"}mported ${data.imported}. Duplicates skipped ${data.duplicates ?? 0}. Invalid ${data.skipped}. DNC (imported suppressed) ${data.dncHits ?? 0}.`,
    );
    onImported();
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-xl border border-[var(--line)] bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-[family-name:var(--font-display)] text-xl">
              + Add Leads
            </h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Upload CSV → map fields → DNC scrub → import (Smartlead Leads
              tab). Extra columns become {"{{variables}}"}.
            </p>
          </div>
          <button type="button" className="sl-btn sl-btn-ghost" onClick={onNext}>
            Next: Sequence
          </button>
        </div>
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
          <Field label="Import mode">
            <select
              className={inputClass}
              value={mode}
              onChange={(e) => setMode(e.target.value as "append" | "replace")}
            >
              <option value="append">Append (skip duplicate phones)</option>
              <option value="replace">Replace all leads in campaign</option>
            </select>
          </Field>
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

      <section className="sl-table-wrap">
        <div className="border-b border-[var(--line)] px-5 py-4">
          <h2 className="font-[family-name:var(--font-display)] text-xl">
            Lead list ({leads.length})
          </h2>
          {leads.length > 50 ? (
            <p className="mt-1 text-xs text-[var(--muted)]">
              Showing 50 of {leads.length}
            </p>
          ) : null}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-white/60 text-xs uppercase tracking-wider text-[var(--muted)]">
              <tr>
                <th className="px-4 py-3 font-medium">Phone</th>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Company</th>
                <th className="px-4 py-3 font-medium">Send status</th>
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
                      className={`badge ${
                        l.dnc || (l.status ?? "PENDING") === "SUPPRESSED"
                          ? "badge-danger"
                          : (l.status ?? "PENDING") === "SENT"
                            ? "badge-ok"
                            : "badge-muted"
                      }`}
                    >
                      {l.status ?? "PENDING"}
                      {l.dnc ? " · DNC" : ""}
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
  onNext,
}: {
  campaign: CampaignRecord;
  onSave: (body: Partial<CampaignRecord>) => Promise<void>;
  onNext: () => void;
}) {
  const step = campaign.steps[0];
  const [script, setScript] = useState(step?.scriptTemplate ?? "");
  const [delay, setDelay] = useState(String(step?.delayDays ?? 0));
  const [audioUrl, setAudioUrl] = useState(
    campaign.audioUrl ?? step?.audioUrl ?? "",
  );
  const [recordingId, setRecordingId] = useState(
    campaign.dropCowboyRecordingId ?? step?.recordingId ?? "",
  );

  useEffect(() => {
    setScript(step?.scriptTemplate ?? "");
    setDelay(String(step?.delayDays ?? 0));
    setAudioUrl(campaign.audioUrl ?? step?.audioUrl ?? "");
    setRecordingId(campaign.dropCowboyRecordingId ?? step?.recordingId ?? "");
  }, [
    step?.scriptTemplate,
    step?.delayDays,
    step?.audioUrl,
    step?.recordingId,
    campaign.audioUrl,
    campaign.dropCowboyRecordingId,
  ]);

  return (
    <section className="rounded-xl border border-[var(--line)] bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-[family-name:var(--font-display)] text-xl">
            Sequence
          </h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            RVM steps with wait days. Host a WAV/MP3 (≥5s) and paste the public
            URL — Slybroadcast fetches it and shows your Twilio line as caller
            ID. Variables in script notes: {"{{first_name}}"}, {"{{company}}"}.
          </p>
        </div>
        <button type="button" className="sl-btn sl-btn-ghost" onClick={onNext}>
          Next: Phone Lines
        </button>
      </div>
      <div className="mt-4 flex flex-col gap-4">
        <Field label="Script template (notes / compliance copy)">
          <textarea
            rows={6}
            className={inputClass}
            value={script}
            onChange={(e) => setScript(e.target.value)}
          />
        </Field>
        <Field label="Audio URL (required — Slybroadcast c_url)">
          <input
            className={inputClass}
            value={audioUrl}
            onChange={(e) => setAudioUrl(e.target.value)}
            placeholder="https://…/message.mp3"
          />
        </Field>
        <Field label="Drop Cowboy recording id (only if RVM_PROVIDER=dropcowboy)">
          <input
            className={inputClass}
            value={recordingId}
            onChange={(e) => setRecordingId(e.target.value)}
            placeholder="Optional recording GUID"
          />
        </Field>
        <Field label="Delay before send (days)">
          <input
            className={inputClass}
            value={delay}
            onChange={(e) => setDelay(e.target.value)}
          />
        </Field>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="sl-btn sl-btn-primary"
            onClick={() =>
              void onSave({
                audioUrl: audioUrl || undefined,
                dropCowboyRecordingId: recordingId || undefined,
                steps: [
                  {
                    id: step?.id ?? "step_1",
                    position: 1,
                    delayDays: Number(delay) || 0,
                    scriptTemplate: script,
                    recordingId: recordingId || undefined,
                    audioUrl: audioUrl || undefined,
                  },
                  ...campaign.steps.filter((s) => s.position !== 1),
                ],
              })
            }
          >
            Save step
          </button>
          <button
            type="button"
            className="sl-btn sl-btn-ghost"
            onClick={() => {
              const nextPos =
                Math.max(0, ...campaign.steps.map((s) => s.position)) + 1;
              void onSave({
                steps: [
                  ...campaign.steps,
                  {
                    id: `step_${nextPos}`,
                    position: nextPos,
                    delayDays: 2,
                    scriptTemplate:
                      "Hey {{first_name}}, just following up on my last voicemail about {{company}}.",
                  },
                ],
              });
            }}
          >
            + Add step
          </button>
        </div>
        {campaign.steps.length > 1 ? (
          <ul className="mt-2 space-y-1 text-sm text-[var(--muted)]">
            {campaign.steps
              .slice()
              .sort((a, b) => a.position - b.position)
              .map((s) => (
                <li key={s.id}>
                  Step {s.position} · wait {s.delayDays}d ·{" "}
                  {s.scriptTemplate.slice(0, 60)}
                  {s.scriptTemplate.length > 60 ? "…" : ""}
                </li>
              ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}

function LinesTab({
  campaign,
  onSave,
  onNext,
}: {
  campaign: CampaignRecord;
  onSave: (body: Partial<CampaignRecord>) => Promise<void>;
  onNext: () => void;
}) {
  const [pool, setPool] = useState(campaign.lineIds.join(", "));

  useEffect(() => {
    setPool(campaign.lineIds.join(", "));
  }, [campaign.lineIds]);

  return (
    <section className="rounded-xl border border-[var(--line)] bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-[family-name:var(--font-display)] text-xl">
            Phone Lines
          </h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Assign warmed Twilio DIDs — Smartlead Email Accounts tab for RVM
            caller IDs. Empty pool fails closed.
          </p>
        </div>
        <button type="button" className="sl-btn sl-btn-ghost" onClick={onNext}>
          Next: Settings
        </button>
      </div>
      <div className="mt-4 flex flex-col gap-4">
        <Field label="Line pool (E.164 or demo ids)">
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
          className="sl-btn sl-btn-primary w-fit"
          onClick={() =>
            void onSave({
              lineIds: pool
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
            })
          }
        >
          Save phone lines
        </button>
      </div>
    </section>
  );
}

function ScheduleTab({
  campaign,
  onSave,
  onNext,
}: {
  campaign: CampaignRecord;
  onSave: (body: Partial<CampaignRecord>) => Promise<void>;
  onNext: () => void;
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
    <section className="rounded-xl border border-[var(--line)] bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-[family-name:var(--font-display)] text-xl">
            Settings
          </h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Schedule · campaign behavior · protection — Smartlead Settings tab.
          </p>
        </div>
        <button type="button" className="sl-btn sl-btn-ghost" onClick={onNext}>
          Next: Launch
        </button>
      </div>

      <h3 className="mt-6 text-sm font-semibold uppercase tracking-wider text-[var(--muted)]">
        Schedule configuration
      </h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
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
        <Field label="Active days (0=Sun … 6=Sat)">
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

      <h3 className="mt-6 text-sm font-semibold uppercase tracking-wider text-[var(--muted)]">
        Campaign behavior
      </h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={campaign.schedule.stopOnCallback}
            onChange={(e) =>
              void onSave({
                schedule: {
                  ...campaign.schedule,
                  stopOnCallback: e.target.checked,
                },
              })
            }
          />
          Stop on callback
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={campaign.schedule.stopOnOptOut}
            onChange={(e) =>
              void onSave({
                schedule: {
                  ...campaign.schedule,
                  stopOnOptOut: e.target.checked,
                },
              })
            }
          />
          Stop on opt-out / STOP
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={campaign.schedule.requireConsent}
            onChange={(e) =>
              void onSave({
                schedule: {
                  ...campaign.schedule,
                  requireConsent: e.target.checked,
                },
              })
            }
          />
          Require express consent (hard gate)
        </label>
      </div>

      <button
        type="button"
        className="sl-btn sl-btn-primary mt-5 w-fit"
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
        Save settings
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
    <section className="rounded-xl border border-[var(--line)] bg-white p-5">
      <h2 className="font-[family-name:var(--font-display)] text-xl">
        Preview / review
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
  leads,
  onSave,
}: {
  campaign: CampaignRecord;
  leads: LeadRecord[];
  onSave: (body: Partial<CampaignRecord>) => Promise<void>;
}) {
  const sendable = leads.filter((l) => {
    const s = l.status ?? "PENDING";
    return (
      !l.dnc &&
      l.consentStatus !== "OPTED_OUT" &&
      s !== "SUPPRESSED" &&
      s !== "SENT"
    );
  });
  const sent = leads.filter((l) => l.status === "SENT").length;
  const suppressed = leads.filter(
    (l) => l.dnc || l.status === "SUPPRESSED",
  ).length;
  const hasLines = campaign.lineIds.length > 0;
  const hasAudio = Boolean(
    campaign.audioUrl ||
      campaign.steps[0]?.audioUrl ||
      campaign.dropCowboyRecordingId ||
      campaign.steps[0]?.recordingId,
  );
  const canStart =
    sendable.length > 0 && hasLines && hasAudio && campaign.schedule.sendDays.length > 0;

  return (
    <section className="rounded-xl border border-[var(--line)] bg-white p-5">
      <h2 className="font-[family-name:var(--font-display)] text-xl">
        Launch Campaign
      </h2>
      <p className="mt-1 text-sm text-[var(--muted)]">
        Status: <strong>{campaign.status}</strong>. Same Smartlead gate: leads +
        sequence + phone lines + settings, then go live. Cron drains every 5
        minutes.
      </p>
      <ul className="mt-4 space-y-1 text-sm">
        <li>
          Sendable: <strong>{sendable.length}</strong> · Sent: {sent} ·
          Suppressed/DNC: {suppressed} · Total: {leads.length}
        </li>
        <li>
          Lines:{" "}
          {hasLines ? (
            <strong>{campaign.lineIds.length}</strong>
          ) : (
            <span className="text-[var(--danger)]">none — set Lines tab</span>
          )}
        </li>
        <li>
          Audio/voice:{" "}
          {hasAudio ? (
            <strong>configured</strong>
          ) : (
            <span className="text-[var(--danger)]">
              missing — set Sequence tab
            </span>
          )}
        </li>
        {campaign.lastDrainAt ? (
          <li className="text-[var(--muted)]">
            Last drain {new Date(campaign.lastDrainAt).toLocaleString()} — sent{" "}
            {campaign.lastDrainStats?.sent ?? 0}, skipped{" "}
            {campaign.lastDrainStats?.skipped ?? 0}, failed{" "}
            {campaign.lastDrainStats?.failed ?? 0}
          </li>
        ) : null}
      </ul>
      <div className="mt-4 flex flex-wrap gap-2">
        {campaign.status !== "ACTIVE" ? (
          <button
            type="button"
            className="sl-btn sl-btn-primary"
            onClick={() => void onSave({ status: "ACTIVE" })}
            disabled={!canStart}
          >
            Launch Campaign
          </button>
        ) : (
          <button
            type="button"
            className="sl-btn sl-btn-ghost"
            onClick={() => void onSave({ status: "PAUSED" })}
          >
            Pause
          </button>
        )}
        <button
          type="button"
          className="sl-btn sl-btn-ghost"
          onClick={() => void onSave({ status: "DRAFT" })}
        >
          Back to draft
        </button>
      </div>
      {!canStart && campaign.status !== "ACTIVE" ? (
        <p className="mt-3 text-sm text-[var(--warn)]">
          Start is blocked until you have sendable leads, lines, and
          audio/voice.
        </p>
      ) : null}
    </section>
  );
}
