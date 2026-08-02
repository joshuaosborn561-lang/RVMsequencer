"use client";

import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import type { ApiKeyRecord, ClientRecord } from "@/lib/store/types";

export default function ClientsPage() {
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [keys, setKeys] = useState<ApiKeyRecord[]>([]);
  const [name, setName] = useState("");
  const [hubspotOptIn, setHubspotOptIn] = useState(false);
  const [keyName, setKeyName] = useState("Default");
  const [clientId, setClientId] = useState("client_demo");
  const [freshKey, setFreshKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [cRes, kRes] = await Promise.all([
      fetch("/api/clients"),
      fetch("/api/clients/keys"),
    ]);
    const cData = (await cRes.json()) as { clients: ClientRecord[] };
    const kData = (await kRes.json()) as { keys: ApiKeyRecord[] };
    setClients(cData.clients);
    setKeys(kData.keys);
    setClientId((prev) =>
      cData.clients.some((c) => c.id === prev)
        ? prev
        : (cData.clients[0]?.id ?? prev),
    );
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function createClient() {
    if (!name.trim()) return;
    setBusy(true);
    await fetch("/api/clients", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        hubspotOptIn,
      }),
    });
    setName("");
    setHubspotOptIn(false);
    setBusy(false);
    await load();
  }

  async function toggleHubspot(client: ClientRecord) {
    setBusy(true);
    await fetch("/api/clients", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: client.id,
        hubspotOptIn: !client.hubspotOptIn,
      }),
    });
    setBusy(false);
    await load();
  }

  async function saveOwnerId(client: ClientRecord, ownerId: string) {
    setBusy(true);
    await fetch("/api/clients", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: client.id,
        hubspotOwnerId: ownerId.trim() || null,
      }),
    });
    setBusy(false);
    await load();
  }

  async function createKey() {
    setBusy(true);
    setFreshKey(null);
    const res = await fetch("/api/clients/keys", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientId, name: keyName.trim() || "Default" }),
    });
    const data = (await res.json()) as { key: ApiKeyRecord };
    setFreshKey(data.key.key ?? null);
    setBusy(false);
    await load();
  }

  async function revoke(id: string) {
    await fetch("/api/clients/keys", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    });
    await load();
  }

  return (
    <AppShell
      title="Client Access"
      subtitle="Agency view — assign clients, HubSpot opt-in, and API keys."
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="panel rounded-xl p-5">
          <h2 className="font-[family-name:var(--font-display)] text-xl">
            Clients
          </h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            When HubSpot sync is on, inbound voice callbacks and inbox CALLBACK
            tags create/update HubSpot contacts for that client&apos;s campaigns.
          </p>
          <div className="mt-4 flex flex-col gap-2">
            <div className="flex gap-2">
              <input
                className="flex-1 rounded-lg border border-[var(--line)] bg-white px-3 py-2 text-sm"
                placeholder="Client name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <button
                type="button"
                disabled={busy || !name.trim()}
                className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                onClick={() => void createClient()}
              >
                Add
              </button>
            </div>
            <label className="flex items-center gap-2 text-sm text-[var(--muted)]">
              <input
                type="checkbox"
                checked={hubspotOptIn}
                onChange={(e) => setHubspotOptIn(e.target.checked)}
              />
              Opt in to HubSpot callback sync
            </label>
          </div>
          <ul className="mt-4 divide-y divide-[var(--line)]">
            {clients.map((c) => (
              <li key={c.id} className="flex flex-col gap-2 py-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-medium">{c.name}</p>
                    <p className="font-[family-name:var(--font-mono)] text-xs text-[var(--muted)]">
                      {c.id}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      className={
                        c.hubspotOptIn ? "badge badge-ok" : "badge badge-muted"
                      }
                      onClick={() => void toggleHubspot(c)}
                      title="Toggle HubSpot callback sync"
                    >
                      HubSpot {c.hubspotOptIn ? "on" : "off"}
                    </button>
                    <button
                      type="button"
                      className="badge badge-muted"
                      onClick={() => setClientId(c.id)}
                    >
                      {clientId === c.id ? "Selected" : "Select"}
                    </button>
                  </div>
                </div>
                {c.hubspotOptIn ? (
                  <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
                    HubSpot owner id (optional)
                    <input
                      className="rounded-lg border border-[var(--line)] bg-white px-3 py-1.5 font-[family-name:var(--font-mono)] text-sm text-[var(--ink)]"
                      defaultValue={c.hubspotOwnerId ?? ""}
                      placeholder="e.g. 12345678"
                      onBlur={(e) => {
                        const next = e.target.value.trim();
                        if (next !== (c.hubspotOwnerId ?? "")) {
                          void saveOwnerId(c, next);
                        }
                      }}
                    />
                  </label>
                ) : null}
              </li>
            ))}
          </ul>
        </section>

        <section className="panel rounded-xl p-5">
          <h2 className="font-[family-name:var(--font-display)] text-xl">
            API keys
          </h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Creating a key shows the secret once. We store only a SHA-256 hash
            and a short prefix for display.
          </p>
          <div className="mt-4 flex flex-col gap-3">
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="text-[var(--muted)]">Client</span>
              <select
                className="rounded-lg border border-[var(--line)] bg-white px-3 py-2"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
              >
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="text-[var(--muted)]">Key name</span>
              <input
                className="rounded-lg border border-[var(--line)] bg-white px-3 py-2"
                value={keyName}
                onChange={(e) => setKeyName(e.target.value)}
              />
            </label>
            <button
              type="button"
              disabled={busy || !clientId}
              className="w-fit rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              onClick={() => void createKey()}
            >
              Generate key
            </button>
            {freshKey ? (
              <div className="rounded-lg border border-[var(--accent)] bg-[var(--accent-soft)] p-3">
                <p className="text-xs uppercase tracking-wider text-[var(--accent)]">
                  Copy now — shown once
                </p>
                <p className="mt-1 break-all font-[family-name:var(--font-mono)] text-sm">
                  {freshKey}
                </p>
              </div>
            ) : null}
          </div>

          <ul className="mt-6 divide-y divide-[var(--line)]">
            {keys.length === 0 ? (
              <li className="py-4 text-sm text-[var(--muted)]">
                No active keys.
              </li>
            ) : (
              keys.map((k) => (
                <li
                  key={k.id}
                  className="flex items-center justify-between gap-3 py-3 text-sm"
                >
                  <div>
                    <p className="font-medium">{k.name}</p>
                    <p className="text-xs text-[var(--muted)]">
                      {k.clientId} · {k.keyPrefix}…
                    </p>
                  </div>
                  <button
                    type="button"
                    className="badge badge-danger"
                    onClick={() => void revoke(k.id)}
                  >
                    Revoke
                  </button>
                </li>
              ))
            )}
          </ul>
        </section>
      </div>
    </AppShell>
  );
}
