import { NextResponse } from "next/server";
import { listAuditEvents } from "@/lib/store/db";

/** Append-only audit trail (newest first). */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = Math.min(
    500,
    Math.max(1, Number(url.searchParams.get("limit") ?? "100") || 100),
  );
  const campaignId = url.searchParams.get("campaignId") ?? undefined;
  const events = await listAuditEvents({ limit, campaignId });
  return NextResponse.json({ events });
}
