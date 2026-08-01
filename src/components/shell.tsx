import Link from "next/link";

const nav = [
  { href: "/", label: "Overview" },
  { href: "/lines", label: "Lines" },
  { href: "/campaigns", label: "Campaigns" },
  { href: "/voices", label: "Voices" },
  { href: "/deliverability", label: "Deliverability" },
  { href: "/settings", label: "Research" },
];

export function Shell({
  children,
  title,
  subtitle,
}: {
  children: React.ReactNode;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="grid-atmosphere min-h-full">
      <div className="mx-auto flex min-h-full w-full max-w-6xl flex-col px-4 py-6 md:px-8 md:py-8">
        <header className="mb-8 flex flex-col gap-6 border-b border-[var(--line)] pb-6 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="font-[family-name:var(--font-display)] text-3xl tracking-tight text-[var(--ink)] md:text-4xl">
              Dropseq
            </p>
            <p className="mt-1 max-w-xl text-sm text-[var(--muted)]">
              RVM sequencer — line pools, warmup, campaigns, and burn detection.
              Smartlead mechanics for voicemail.
            </p>
          </div>
          <nav className="flex flex-wrap gap-2">
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="badge badge-muted transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </header>

        <div className="mb-6">
          <h1 className="font-[family-name:var(--font-display)] text-2xl tracking-tight md:text-3xl">
            {title}
          </h1>
          {subtitle ? (
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--muted)]">
              {subtitle}
            </p>
          ) : null}
        </div>

        <main className="flex-1">{children}</main>

        <footer className="mt-10 border-t border-[var(--line)] pt-4 text-xs text-[var(--muted)]">
          Scaffold + research foundation. Wire Twilio / RVM / TTS credentials before
          live sends. TCPA consent required for wireless RVM (FCC 22-85).
        </footer>
      </div>
    </div>
  );
}
