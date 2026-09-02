import { NextResponse } from "next/server";
import { toE164 } from "@/lib/phone";
import {
  listPersistedReputation,
  runDailyReputationChecks,
  shouldRunDailyReputation,
} from "@/lib/reputation/run-daily";

/**
 * Daily spam / blacklist / health check for Twilio from-numbers.
 * Auth: CRON_SECRET (x-cron-secret or Bearer).
 *
 * GET  — persisted last-check snapshot (no live CallTracer unless refresh=1)
 * GET  ?e164=+1…           — one DID from store
 * GET  ?refresh=1          — force CallTracer (+ Hiya if keyed) for the pool
 * GET  ?refresh=1&e164=+1… — force-refresh one DID
 * POST `{ "force": true, "e164": "+1…" }` — same as daily job / single refresh
 */
function authorize(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  const header = req.headers.get("x-cron-secret") ?? "";
  const auth = req.headers.get("authorization") ?? "";
  return header === secret || auth === `Bearer ${secret}`;
}

function parseE164(
  raw: string | null,
): { ok: true; e164?: string } | { ok: false } {
  if (!raw?.trim()) return { ok: true, e164: undefined };
  const e164 = toE164(raw);
  if (!e164) return { ok: false };
  return { ok: true, e164 };
}

export async function GET(req: Request) {
  if (!authorize(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const parsedPhone = parseE164(url.searchParams.get("e164"));
  if (!parsedPhone.ok) {
    return NextResponse.json({ error: "invalid_e164" }, { status: 400 });
  }
  const e164 = parsedPhone.e164;
  const refresh =
    url.searchParams.get("refresh") === "1" ||
    url.searchParams.get("refresh") === "true" ||
    url.searchParams.get("force") === "1" ||
    url.searchParams.get("force") === "true";

  if (refresh) {
    const result = await runDailyReputationChecks({
      force: true,
      e164,
    });
    return NextResponse.json(result);
  }

  const gate = await shouldRunDailyReputation(false);
  const persisted = await listPersistedReputation(e164);
  return NextResponse.json({
    due: gate.run,
    reason: gate.reason ?? null,
    calltracerEnabled: true,
    hiyaEnabled: Boolean(process.env.HIYA_API_KEY?.trim()),
    lastReputationCheckAt: persisted.lastReputationCheckAt,
    lines: persisted.lines,
  });
}

export async function POST(req: Request) {
  if (!authorize(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let force = false;
  let e164: string | undefined;
  const raw = await req.text();
  if (raw.trim()) {
    try {
      const json = JSON.parse(raw) as { force?: boolean; e164?: string };
      force = json.force === true;
      const parsedPhone = parseE164(json.e164 ?? null);
      if (!parsedPhone.ok) {
        return NextResponse.json({ error: "invalid_e164" }, { status: 400 });
      }
      e164 = parsedPhone.e164;
    } catch {
      return NextResponse.json({ error: "invalid_json" }, { status: 400 });
    }
  }

  const result = await runDailyReputationChecks({ force, e164 });
  return NextResponse.json(result);
}
