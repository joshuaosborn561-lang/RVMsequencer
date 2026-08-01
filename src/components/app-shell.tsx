"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const nav = [
  { href: "/", label: "Overview" },
  { href: "/campaigns", label: "Campaigns" },
  { href: "/inbox", label: "Master Inbox" },
  { href: "/lines", label: "Lines" },
  { href: "/clients", label: "Clients / API" },
  { href: "/deliverability", label: "Deliverability" },
  { href: "/voices", label: "Voices" },
  { href: "/settings", label: "Go live" },
];

export function AppShell({
  children,
  title,
  subtitle,
  actions,
}: {
  children: React.ReactNode;
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="grid-atmosphere min-h-full">
      <div className="mx-auto flex min-h-full w-full max-w-7xl gap-0 md:gap-8 px-0 md:px-6 py-0 md:py-6">
        <aside className="hidden w-56 shrink-0 border-r border-[var(--line)] bg-white/50 p-5 md:block md:rounded-2xl md:border">
          <p className="font-[family-name:var(--font-display)] text-2xl tracking-tight">
            Dropseq
          </p>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Smartlead for RVM
          </p>
          <nav className="mt-8 flex flex-col gap-1">
            {nav.map((item) => {
              const active =
                item.href === "/"
                  ? pathname === "/"
                  : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`rounded-lg px-3 py-2 text-sm transition ${
                    active
                      ? "bg-[var(--accent-soft)] font-medium text-[var(--accent)]"
                      : "text-[var(--muted)] hover:bg-white hover:text-[var(--ink)]"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col px-4 py-6 md:px-2 md:py-2">
          <div className="mb-4 flex flex-wrap gap-2 md:hidden">
            {nav.map((item) => (
              <Link key={item.href} href={item.href} className="badge badge-muted">
                {item.label}
              </Link>
            ))}
          </div>

          <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="font-[family-name:var(--font-display)] text-2xl tracking-tight md:text-3xl">
                {title}
              </h1>
              {subtitle ? (
                <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">
                  {subtitle}
                </p>
              ) : null}
            </div>
            {actions}
          </header>

          <main className="flex-1">{children}</main>
        </div>
      </div>
    </div>
  );
}
