"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Smartlead-mirrored IA — RVM labels where email → phone. */
const NAV_GROUPS: {
  label?: string;
  items: { href: string; label: string; match?: string }[];
}[] = [
  {
    items: [
      { href: "/campaigns", label: "Campaigns", match: "/campaigns" },
      { href: "/inbox", label: "Master Inbox", match: "/inbox" },
      { href: "/lines", label: "Phone Lines", match: "/lines" },
      { href: "/leads", label: "All Leads", match: "/leads" },
    ],
  },
  {
    label: "Engage",
    items: [
      { href: "/voices", label: "Voices", match: "/voices" },
      { href: "/deliverability", label: "Deliverability", match: "/deliverability" },
      { href: "/clients", label: "Client Access", match: "/clients" },
    ],
  },
  {
    label: "Insights",
    items: [
      { href: "/analytics", label: "Global Analytics", match: "/analytics" },
    ],
  },
  {
    items: [{ href: "/settings", label: "Settings", match: "/settings" }],
  },
];

function isActive(pathname: string, match: string) {
  if (match === "/campaigns") {
    return pathname === "/campaigns" || pathname.startsWith("/campaigns/");
  }
  return pathname === match || pathname.startsWith(`${match}/`);
}

export function AppShell({
  children,
  title,
  subtitle,
  actions,
  bare,
}: {
  children: React.ReactNode;
  title?: string;
  subtitle?: string;
  actions?: React.ReactNode;
  /** Hide page header (campaign detail uses its own). */
  bare?: boolean;
}) {
  const pathname = usePathname();
  const flat = NAV_GROUPS.flatMap((g) => g.items);

  return (
    <div className="sl-shell min-h-full">
      <div className="flex min-h-full">
        <aside className="sl-sidebar hidden w-[232px] shrink-0 flex-col md:flex">
          <div className="border-b border-[var(--line)] px-4 py-4">
            <Link href="/campaigns" className="block">
              <p className="font-[family-name:var(--font-display)] text-xl tracking-tight">
                RVM Drop
              </p>
              <p className="mt-0.5 text-[11px] text-[var(--muted)]">
                Smartlead for ringless voicemail
              </p>
            </Link>
          </div>
          <nav className="flex flex-1 flex-col gap-4 overflow-y-auto px-2 py-3">
            {NAV_GROUPS.map((group, gi) => (
              <div key={gi}>
                {group.label ? (
                  <p className="mb-1 px-2 text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--muted)]">
                    {group.label}
                  </p>
                ) : null}
                <div className="flex flex-col gap-0.5">
                  {group.items.map((item) => {
                    const active = isActive(pathname, item.match ?? item.href);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={`sl-nav-item ${active ? "sl-nav-item-active" : ""}`}
                      >
                        {item.label}
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>
          <div className="border-t border-[var(--line)] px-4 py-3">
            <Link
              href="/settings"
              className="text-xs text-[var(--muted)] hover:text-[var(--ink)]"
            >
              Workspace · Settings
            </Link>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex flex-wrap gap-1.5 border-b border-[var(--line)] bg-white/60 px-3 py-2 md:hidden">
            {flat.map((item) => {
              const active = isActive(pathname, item.match ?? item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`rounded-md px-2.5 py-1 text-xs ${
                    active
                      ? "bg-[var(--accent-soft)] font-medium text-[var(--accent)]"
                      : "text-[var(--muted)]"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>

          <div className="flex min-h-0 flex-1 flex-col px-4 py-4 md:px-6 md:py-5">
            {!bare && title ? (
              <header className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <h1 className="font-[family-name:var(--font-display)] text-2xl tracking-tight md:text-[1.65rem]">
                    {title}
                  </h1>
                  {subtitle ? (
                    <p className="mt-0.5 max-w-3xl text-sm text-[var(--muted)]">
                      {subtitle}
                    </p>
                  ) : null}
                </div>
                {actions ? (
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    {actions}
                  </div>
                ) : null}
              </header>
            ) : null}
            <main className="flex min-h-0 flex-1 flex-col">{children}</main>
          </div>
        </div>
      </div>
    </div>
  );
}
