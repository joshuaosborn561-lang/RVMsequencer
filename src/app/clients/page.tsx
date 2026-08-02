"use client";

import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import type { ApiKeyRecord, ClientRecord } from "@/lib/store/types";

export default function ClientsPage() {
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [keys, setKeys] = useState<ApiKeyRecord[]>([]);
  const [name, setName] = useState("");
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
      body: JSON.stringify({ name: name.trim() }),
    });
    setName("");
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
      subtitle="Agency view — assign clients and API keys (Smartlead Client Access)."
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="panel rounded-xl p-5">
          <h2 className="font-[family-name:var(--font-display)] text-xl">
            Clients
          </h2>
          <div className="mt-4 flex gap-2">
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
          <ul className="mt-4 divide-y divide-[var(--line)]">
            {clients.map((c) => (
              <li
                key={c.id}
                className="flex items-center justify-between gap-3 py-3 text-sm"
              >
                <div>
                  <p className="font-medium">{c.name}</p>
                  <p className="font-[family-name:var(--font-mono)] text-xs text-[var(--muted)]">
                    {c.id}
                  </p>
                </div>
                <button
                  type="button"
                  className="badge badge-muted"
                  onClick={() => setClientId(c.id)}
                >
                  {clientId === c.id ? "Selected" : "Select"}
                </button>
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
