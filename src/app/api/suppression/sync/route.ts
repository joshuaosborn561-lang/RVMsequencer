import { NextResponse } from "next/server";
import { getAlloSuppressionSyncStatus, runAlloSuppressionSync } from "@/lib/allo/sync";
import {
  getSuppressionFanoutStatus,
  runSuppressionFanout,
} from "@/lib/suppression-fanout/engine";

function authorizeCron(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return process.env.NODE_ENV !== "production";
  }
  const header = req.headers.get("x-cron-secret") ?? "";
  const auth = req.headers.get("authorization") ?? "";
  return header === secret || auth === `Bearer ${secret}`;
}

/**
 * GET — counts only. Last-run outcomes, per-destination ok/failed/pending.
 * Never returns phones or emails.
 */
export async function GET(req: Request) {
  if (!authorizeCron(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const [allo, fanout] = await Promise.all([
    getAlloSuppressionSyncStatus(),
    getSuppressionFanoutStatus(),
  ]);
  return NextResponse.json({ allo, fanout });
}

/**
 * POST — run Allo classification (optional) then fan-out.
 * body: { backfill?: boolean, force?: boolean, allo?: boolean }
 */
export async function POST(req: Request) {
  if (!authorizeCron(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let body: { backfill?: boolean; force?: boolean; allo?: boolean } = {};
  try {
    const raw = await req.text();
    if (raw.trim()) body = JSON.parse(raw) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const force = Boolean(body.force) || Boolean(body.backfill);
  const runAllo = body.allo !== false;
  try {
    const allo = runAllo
      ? await runAlloSuppressionSync({
          backfill: Boolean(body.backfill),
          force,
        })
      : { ran: false, skippedReason: "skipped_by_request" };
    const fanout = await runSuppressionFanout({
      backfill: Boolean(body.backfill),
      force,
    });
    return NextResponse.json({ allo, fanout });
  } catch (err) {
    const message = err instanceof Error ? err.message : "sync_failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
