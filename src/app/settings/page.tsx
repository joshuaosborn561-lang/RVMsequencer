"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";

type Section =
  | "general"
  | "forwarding"
  | "webhooks"
  | "limits"
  | "api"
  | "golive";

const SECTIONS: { id: Section; label: string }[] = [
  { id: "general", label: "General" },
  { id: "forwarding", label: "Call forwarding" },
  { id: "webhooks", label: "Webhooks" },
  { id: "limits", label: "Protection & limits" },
  { id: "api", label: "API keys" },
  { id: "golive", label: "Go-live checklist" },
];

export default function SettingsPage() {
  const [section, setSection] = useState<Section>("forwarding");
  const [phone, setPhone] = useState("");
  const [timeoutSec, setTimeoutSec] = useState("30");
  const [minGap, setMinGap] = useState("600");
  const [effective, setEffective] = useState<{
    callForwardToE164: string | null;
    source: string;
  } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/settings");
    const data = await res.json();
    setPhone(data.settings?.callForwardToE164 ?? "");
    setTimeoutSec(String(data.settings?.callForwardTimeoutSec ?? 30));
    setMinGap(String(data.settings?.lineMinGapSec ?? 600));
    setEffective(data.effective);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(patch: Record<string, unknown>) {
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setMsg(data.hint ?? data.error ?? "Save failed");
      return;
    }
    setEffective(data.effective);
    setPhone(data.settings?.callForwardToE164 ?? "");
    setMsg("Saved");
  }

  const webhookUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/api/webhooks/twilio/inbound`
      : "https://rvm-drop-production.up.railway.app/api/webhooks/twilio/inbound";

  return (
    <AppShell
      title="Settings"
      subtitle="Workspace settings — Smartlead profile/settings equivalent."
    >
      <div className="grid gap-6 lg:grid-cols-[200px_1fr]">
        <aside className="flex flex-col gap-0.5">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`sl-nav-item text-left ${
                section === s.id ? "sl-nav-item-active" : ""
              }`}
              onClick={() => setSection(s.id)}
            >
              {s.label}
            </button>
          ))}
        </aside>

        <div className="rounded-xl border border-[var(--line)] bg-white p-5">
          {section === "general" ? (
            <div className="text-sm text-[var(--muted)]">
              <h2 className="font-[family-name:var(--font-display)] text-xl text-[var(--ink)]">
                General
              </h2>
              <p className="mt-2">
                Workspace brand: <strong>RVM Drop</strong>. Default delivery
                Slybroadcast · Twilio CID · DNC + local windows hard-gated.
              </p>
            </div>
          ) : null}

          {section === "forwarding" ? (
            <div>
              <h2 className="font-[family-name:var(--font-display)] text-xl">
                Call forwarding
              </h2>
              <p className="mt-1 text-sm text-[var(--muted)]">
                When a lead calls a campaign DID, we Dial your Allo line. Dial
                timeout must exceed Allo&apos;s ring time (90s recommended) —
                Twimlets&apos; ~20s default causes Allo to show &quot;dropped
                while ringing&quot;.
              </p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1.5 text-sm">
                  <span className="text-[var(--muted)]">Allo / direct line</span>
                  <input
                    className="sl-input font-[family-name:var(--font-mono)]"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+1…"
                  />
                </label>
                <label className="flex flex-col gap-1.5 text-sm">
                  <span className="text-[var(--muted)]">Ring timeout (sec)</span>
                  <input
                    className="sl-input"
                    value={timeoutSec}
                    onChange={(e) => setTimeoutSec(e.target.value)}
                  />
                </label>
              </div>
              <button
                type="button"
                disabled={busy}
                className="sl-btn sl-btn-primary mt-4"
                onClick={() =>
                  void save({
                    callForwardToE164: phone.trim() || null,
                    callForwardTimeoutSec: Number(timeoutSec) || 90,
                    callForwardRequireAccept: false,
                  })
                }
              >
                Save
              </button>
              {effective?.callForwardToE164 ? (
                <p className="mt-3 text-sm">
                  Active:{" "}
                  <strong className="font-[family-name:var(--font-mono)]">
                    {effective.callForwardToE164}
                  </strong>{" "}
                  <span className="text-[var(--muted)]">
                    (source: {effective.source})
                  </span>
                </p>
              ) : (
                <p className="mt-3 text-sm text-[var(--warn)]">
                  No forward number — callbacks hear unavailable.
                </p>
              )}
            </div>
          ) : null}

          {section === "webhooks" ? (
            <div className="text-sm">
              <h2 className="font-[family-name:var(--font-display)] text-xl">
                Webhooks
              </h2>
              <p className="mt-1 text-[var(--muted)]">
                Point Twilio Voice/SMS here. Status callbacks update the
                attempt ledger.
              </p>
              <div className="mt-4 space-y-3">
                <div className="rounded-lg border border-[var(--line)] bg-[var(--bg)]/50 p-3">
                  <p className="text-[11px] uppercase tracking-wider text-[var(--muted)]">
                    Inbound voice / SMS
                  </p>
                  <p className="mt-1 break-all font-[family-name:var(--font-mono)] text-xs">
                    {webhookUrl}
                  </p>
                </div>
                <div className="rounded-lg border border-[var(--line)] bg-[var(--bg)]/50 p-3">
                  <p className="text-[11px] uppercase tracking-wider text-[var(--muted)]">
                    Status (Slybroadcast / provider webhook)
                  </p>
                  <p className="mt-1 break-all font-[family-name:var(--font-mono)] text-xs">
                    {typeof window !== "undefined"
                      ? `${window.location.origin}/api/webhooks/rvm-status`
                      : "/api/webhooks/rvm-status"}
                  </p>
                </div>
              </div>
            </div>
          ) : null}

          {section === "limits" ? (
            <div>
              <h2 className="font-[family-name:var(--font-display)] text-xl">
                Protection & limits
              </h2>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1.5 text-sm">
                  <span className="text-[var(--muted)]">
                    Line min gap (seconds)
                  </span>
                  <input
                    className="sl-input"
                    value={minGap}
                    onChange={(e) => setMinGap(e.target.value)}
                  />
                </label>
                <p className="sm:col-span-2 text-sm text-[var(--muted)]">
                  Volume is limited per line daily cap (no org-wide pool hard
                  cap). Max 2 attempts per contact per day.
                </p>
              </div>
              <button
                type="button"
                disabled={busy}
                className="sl-btn sl-btn-primary mt-4"
                onClick={() =>
                  void save({
                    lineMinGapSec: Number(minGap) || 600,
                    maxAttemptsPerContactPerDay: 2,
                  })
                }
              >
                Save limits
              </button>
            </div>
          ) : null}

          {section === "api" ? (
            <div className="text-sm">
              <h2 className="font-[family-name:var(--font-display)] text-xl">
                API keys
              </h2>
              <p className="mt-1 text-[var(--muted)]">
                Per-client keys live under Client Access (agency view).
              </p>
              <Link href="/clients" className="sl-btn sl-btn-primary mt-4 inline-flex">
                Open Client Access
              </Link>
            </div>
          ) : null}

          {section === "golive" ? (
            <div className="text-sm text-[var(--muted)]">
              <h2 className="font-[family-name:var(--font-display)] text-xl text-[var(--ink)]">
                Go-live checklist
              </h2>
              <ol className="mt-3 list-decimal space-y-2 pl-5">
                <li>Set Slybroadcast, DNC, Twilio env vars on Railway</li>
                <li>Add Redis + confirm /api/health postgres/redis up</li>
                <li>Call forwarding number above</li>
                <li>Twilio DID voice URL → inbound webhook</li>
                <li>
                  Full guide:{" "}
                  <code className="font-[family-name:var(--font-mono)] text-xs">
                    docs/LIVE.md
                  </code>
                </li>
              </ol>
            </div>
          ) : null}

          {msg ? <p className="mt-3 text-sm text-[var(--muted)]">{msg}</p> : null}
        </div>
      </div>
    </AppShell>
  );
}
