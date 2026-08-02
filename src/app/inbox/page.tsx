"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import type { InboxMessage } from "@/lib/store/types";

/** Smartlead Master Inbox folders — adapted for voice/SMS. */
const FOLDERS: { id: string; label: string }[] = [
  { id: "INBOX", label: "Inbox" },
  { id: "CALLBACK", label: "Callbacks" },
  { id: "INTERESTED", label: "Interested" },
  { id: "NOT_INTERESTED", label: "Not interested" },
  { id: "DNC", label: "Do not contact" },
  { id: "SENT", label: "Sent notes" },
  { id: "OTHER", label: "Other" },
  { id: "ARCHIVED", label: "Archived" },
];

export default function InboxPage() {
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [folder, setFolder] = useState("INBOX");
  const [selected, setSelected] = useState<InboxMessage | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/inbox");
    const data = (await res.json()) as { messages: InboxMessage[] };
    setMessages(data.messages);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => {
    if (folder === "INBOX") {
      return messages.filter(
        (m) => m.category !== "OTHER" || !m.readAt, // show active triage
      );
    }
    if (folder === "ARCHIVED") {
      return messages.filter((m) => m.category === "OTHER" && m.readAt);
    }
    if (folder === "SENT") {
      return messages.filter((m) => m.channel === "NOTE");
    }
    return messages.filter((m) => m.category === folder);
  }, [messages, folder]);

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
    setMessages((prev) => prev.map((m) => (m.id === id ? data.message : m)));
    setSelected((s) => (s?.id === id ? data.message : s));
  }

  return (
    <AppShell
      title="Master Inbox"
      subtitle="Unibox for callbacks & SMS — same Smartlead Master Inbox layout."
    >
      <div className="sl-inbox-layout">
        <aside className="border-r border-[var(--line)] bg-[var(--bg)]/40 p-3">
          <p className="mb-2 px-2 text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--muted)]">
            Folders
          </p>
          <nav className="flex flex-col gap-0.5">
            {FOLDERS.map((f) => (
              <button
                key={f.id}
                type="button"
                className={`sl-nav-item text-left ${
                  folder === f.id ? "sl-nav-item-active" : ""
                }`}
                onClick={() => setFolder(f.id)}
              >
                {f.label}
              </button>
            ))}
          </nav>
        </aside>

        <div className="border-r border-[var(--line)]">
          <div className="border-b border-[var(--line)] px-3 py-2 text-xs text-[var(--muted)]">
            {visible.length} conversations · sort by newest
          </div>
          <ul className="max-h-[70vh] overflow-y-auto divide-y divide-[var(--line)]">
            {visible.length === 0 ? (
              <li className="px-4 py-10 text-center text-sm text-[var(--muted)]">
                No messages in this folder.
              </li>
            ) : (
              visible.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    className={`flex w-full flex-col gap-1 px-3 py-3 text-left hover:bg-[var(--bg)] ${
                      selected?.id === m.id ? "bg-[var(--accent-soft)]/40" : ""
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
                      {!m.readAt ? (
                        <span className="badge badge-ok">New</span>
                      ) : null}
                    </div>
                    <span className="truncate text-xs text-[var(--muted)]">
                      {m.body}
                    </span>
                    <span className="text-[11px] text-[var(--muted)]">
                      {m.category.replaceAll("_", " ")} · {m.channel}
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>

        <div className="flex min-h-[320px] flex-col">
          {!selected ? (
            <div className="flex flex-1 items-center justify-center p-8 text-sm text-[var(--muted)]">
              Select a conversation
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line)] px-4 py-3">
                <div>
                  <p className="font-[family-name:var(--font-mono)] font-medium">
                    {selected.fromE164}
                  </p>
                  <p className="text-xs text-[var(--muted)]">
                    → {selected.toE164} ·{" "}
                    {new Date(selected.createdAt).toLocaleString()}
                  </p>
                </div>
                <select
                  className="sl-input"
                  value={selected.category}
                  onChange={(e) =>
                    void patch(selected.id, {
                      category: e.target.value as InboxMessage["category"],
                    })
                  }
                >
                  {(
                    [
                      "UNREAD",
                      "INTERESTED",
                      "NOT_INTERESTED",
                      "CALLBACK",
                      "DNC",
                      "OTHER",
                    ] as const
                  ).map((c) => (
                    <option key={c} value={c}>
                      {c.replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex-1 overflow-y-auto p-4">
                <div className="rounded-lg border border-[var(--line)] bg-[var(--bg)]/50 p-4 text-sm whitespace-pre-wrap">
                  {selected.body}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}
