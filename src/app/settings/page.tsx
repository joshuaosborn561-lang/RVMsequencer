"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";

const checklist = [
  {
    title: "API keys",
    body: "Drop.co, ElevenLabs, DNC Project, Twilio — set on Railway service RVM Drop.",
  },
  {
    title: "Call forwarding",
    body: "Set your direct line below. Point each Twilio DID Voice URL to /api/webhooks/twilio/inbound.",
  },
  {
    title: "Cron",
    body: "sequencer-cron hits POST /api/sequencer/tick every 5 minutes (already on Railway).",
  },
  {
    title: "Auth",
    body: "Add login before real client data. Per-client API keys live under Clients / API.",
  },
];

export default function SettingsPage() {
  const [phone, setPhone] = useState("");
  const [timeoutSec, setTimeoutSec] = useState("30");
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
    setEffective(data.effective);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        callForwardToE164: phone.trim() || null,
        callForwardTimeoutSec: Number(timeoutSec) || 30,
      }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setMsg(data.hint ?? data.error ?? "Save failed");
      return;
    }
    setEffective(data.effective);
    setPhone(data.settings?.callForwardToE164 ?? "");
    setMsg("Saved — callbacks will dial this number.");
  }

  const webhookUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/api/webhooks/twilio/inbound`
      : "https://rvm-drop-production.up.railway.app/api/webhooks/twilio/inbound";

  return (
    <AppShell
      title="Go live"
      subtitle="Call forwarding + remaining launch checklist."
      actions={
        <Link
          href="/campaigns"
          className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white"
        >
          Open campaigns
        </Link>
      }
    >
      <section className="panel mb-6 rounded-xl p-5">
        <h2 className="font-[family-name:var(--font-display)] text-xl">
          Call forwarding
        </h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          When a lead calls back any Twilio campaign DID, we log it in Master
          Inbox and{" "}
          <strong>Dial</strong> your direct line. Your phone shows the lead&apos;s
          number as caller ID when Twilio allows it.
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-[var(--muted)]">Your direct line</span>
            <input
              className="rounded-lg border border-[var(--line)] bg-white px-3 py-2 font-[family-name:var(--font-mono)]"
              placeholder="+1…"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-[var(--muted)]">Ring timeout (seconds)</span>
            <input
              className="rounded-lg border border-[var(--line)] bg-white px-3 py-2"
              value={timeoutSec}
              onChange={(e) => setTimeoutSec(e.target.value)}
            />
          </label>
        </div>

        <button
          type="button"
          disabled={busy}
          className="mt-4 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          onClick={() => void save()}
        >
          {busy ? "Saving…" : "Save forward-to number"}
        </button>

        {effective?.callForwardToE164 ? (
          <p className="mt-3 text-sm">
            Active:{" "}
            <strong className="font-[family-name:var(--font-mono)]">
              {effective.callForwardToE164}
            </strong>{" "}
            <span className="text-[var(--muted)]">
              (source: {effective.source}
              {effective.source === "env"
                ? " — CALL_FORWARD_TO_E164 overrides UI"
                : ""}
              )
            </span>
          </p>
        ) : (
          <p className="mt-3 text-sm text-[var(--warn)]">
            No forward number set — callbacks will hear a short unavailable
            message.
          </p>
        )}
        {msg ? <p className="mt-2 text-sm text-[var(--muted)]">{msg}</p> : null}

        <div className="mt-5 rounded-lg border border-[var(--line)] bg-white/70 p-3 text-sm">
          <p className="text-xs uppercase tracking-wider text-[var(--muted)]">
            Twilio Voice URL (each DID)
          </p>
          <p className="mt-1 break-all font-[family-name:var(--font-mono)] text-xs">
            {webhookUrl}
          </p>
          <p className="mt-2 text-[var(--muted)]">
            Console → Phone Numbers → each DID → Voice &amp; Fax → Webhook A
            CALL COMES IN → HTTP POST → that URL. Messaging can use the same
            URL for SMS → Inbox.
          </p>
        </div>
      </section>

      <div className="grid gap-4">
        {checklist.map((f, i) => (
          <article key={f.title} className="panel rounded-xl p-5">
            <p className="text-xs uppercase tracking-[0.14em] text-[var(--muted)]">
              Step {i + 1}
            </p>
            <h2 className="mt-1 font-[family-name:var(--font-display)] text-xl">
              {f.title}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">
              {f.body}
            </p>
          </article>
        ))}
      </div>
    </AppShell>
  );
}
