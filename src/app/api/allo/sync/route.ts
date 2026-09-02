import { NextResponse } from "next/server";
import {
  getAlloSuppressionSyncStatus,
  runAlloSuppressionSync,
} from "@/lib/allo/sync";

function authorizeCron(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return process.env.NODE_ENV !== "production";
  }
  const header = req.headers.get("x-cron-secret") ?? "";
  const auth = req.headers.get("authorization") ?? "";
  return header === secret || auth === `Bearer ${secret}`;
}

/** GET — status (no phones). */
export async function GET(req: Request) {
  if (!authorizeCron(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const status = await getAlloSuppressionSyncStatus();
  return NextResponse.json(status);
}

/**
 * POST — run sync.
 * body: { backfill?: boolean, force?: boolean }
 */
export async function POST(req: Request) {
  if (!authorizeCron(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let body: { backfill?: boolean; force?: boolean } = {};
  try {
    const raw = await req.text();
    if (raw.trim()) body = JSON.parse(raw) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  try {
    const result = await runAlloSuppressionSync({
      backfill: Boolean(body.backfill),
      force: Boolean(body.force) || Boolean(body.backfill),
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "sync_failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
