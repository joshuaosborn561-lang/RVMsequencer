import { NextResponse } from "next/server";
import { refreshPendingReceipts } from "@/lib/sequencer/refresh-receipts";

/**
 * Refresh Slybroadcast dial_status into Supabase + scheduled-send deliveryStatus.
 * Same campaign_result path as the sequencer tick, without the settle delay.
 * Auth: same CRON_SECRET.
 */
function authorize(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  const header = req.headers.get("x-cron-secret") ?? "";
  const auth = req.headers.get("authorization") ?? "";
  return header === secret || auth === `Bearer ${secret}`;
}

export async function POST(req: Request) {
  if (!authorize(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const receipts = await refreshPendingReceipts({
    settleMs: 0,
    batchCap: 200,
  });
  return NextResponse.json({
    ok: true,
    refreshed: receipts.refreshed,
    okCount: receipts.ok,
    failed: receipts.failed,
    stillPending: receipts.stillPending,
    flag: receipts.flag,
    health: receipts.health,
    receipts,
  });
}
