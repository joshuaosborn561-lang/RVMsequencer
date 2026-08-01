"use client";

import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import type { InboxMessage } from "@/lib/store/types";

const CATEGORIES: InboxMessage["category"][] = [
  "UNREAD",
  "INTERESTED",
  "NOT_INTERESTED",
  "CALLBACK",
  "DNC",
  "OTHER",
];

export default function InboxPage() {
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [filter, setFilter] = useState<string>("ALL");
  const [selected, setSelected] = useState<InboxMessage | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/inbox");
    const data = (await res.json()) as { messages: InboxMessage[] };
    setMessages(data.messages);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visible =
    filter === "ALL"
      ? messages
      : messages.filter((m) => m.category === filter);

  async function patch(
    id: string,
    body: Partial<Pick<InboxMessage, "category" | "readAt">>,
  ) {
    const res = await fetch("/api/inbox", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, ...body }),
    });
    if (!res.ok) return;
    const data = (await res.json()) as { message: InboxMessage };
    setMessages((prev) =>
      prev.map((m) => (m.id === id ? data.message : m)),
    );
    setSelected((s) => (s?.id === id ? data.message : s));
  }

  return (
    <AppShell
      title="Master Inbox"
      subtitle="Unibox for callbacks, SMS replies, and notes — Smartlead-style, wired to Twilio inbound webhooks when live."
    >
      <div className="mb-4 flex flex-wrap gap-2">
        <button
          type="button"
          className={`badge ${filter === "ALL" ? "badge-ok" : "badge-muted"}`}
          onClick={() => setFilter("ALL")}
        >
          All
        </button>
        {CATEGORIES.map((c) => (
          <button
            key={c}
            type="button"
            className={`badge ${filter === c ? "badge-ok" : "badge-muted"}`}
            onClick={() => setFilter(c)}
          >
            {c.replaceAll("_", " ")}
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_1.1fr]">
        <div className="panel overflow-hidden rounded-xl">
          <ul className="divide-y divide-[var(--line)]">
            {visible.length === 0 ? (
              <li className="px-4 py-8 text-center text-sm text-[var(--muted)]">
                No messages yet. Twilio inbound webhooks will land here.
              </li>
            ) : (
              visible.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    className={`flex w-full flex-col gap-1 px-4 py-3 text-left transition hover:bg-white/70 ${
                      selected?.id === m.id ? "bg-[var(--accent-soft)]/50" : ""
                    }`}
                    onClick={() => {
                      setSelected(m);
                      if (!m.readAt) {
                        void patch(m.id, { readAt: new Date().toISOString() });
                      }
                    }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-[family-name:var(--font-mono)] text-sm">
                        {m.fromE164}
                      </span>
                      <span className="badge badge-muted">{m.channel}</span>
                    </div>
                    <p className="line-clamp-2 text-sm text-[var(--muted)]">
                      {m.body}
                    </p>
                    <div className="flex items-center justify-between text-xs text-[var(--muted)]">
                      <span className="badge">{m.category}</span>
                      <span>{new Date(m.createdAt).toLocaleString()}</span>
                    </div>
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>

        <div className="panel rounded-xl p-5">
          {selected ? (
            <div className="flex flex-col gap-4">
              <div>
                <p className="font-[family-name:var(--font-mono)] text-lg">
                  {selected.fromE164}
                </p>
                <p className="text-sm text-[var(--muted)]">
                  → {selected.toE164} · {selected.channel}
                </p>
              </div>
              <p className="text-sm leading-relaxed whitespace-pre-wrap">
                {selected.body}
              </p>
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="text-[var(--muted)]">Category</span>
                <select
                  className="rounded-lg border border-[var(--line)] bg-white px-3 py-2"
                  value={selected.category}
                  onChange={(e) =>
                    void patch(selected.id, {
                      category: e.target.value as InboxMessage["category"],
                    })
                  }
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ) : (
            <p className="text-sm text-[var(--muted)]">
              Select a message to triage.
            </p>
          )}
        </div>
      </div>
    </AppShell>
  );
}
