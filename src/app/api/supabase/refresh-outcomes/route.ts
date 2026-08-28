import { NextResponse } from "next/server";
import { refreshSlybroadcastOutcome } from "@/lib/supabase/rvm-sync";
import { listCampaigns, listLeads } from "@/lib/store/db";

/**
 * Refresh Slybroadcast dial_status into Supabase for recent SENT leads.
 * Call from cron or after drops. Auth: same CRON_SECRET.
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

  const campaigns = await listCampaigns();
  const results: unknown[] = [];
  for (const c of campaigns) {
    const leads = await listLeads(c.id);
    for (const lead of leads) {
      if (!lead.providerMessageId) continue;
      if (lead.status !== "SENT" && lead.status !== "FAILED") continue;
      const r = await refreshSlybroadcastOutcome(lead.providerMessageId);
      results.push({
        campaignId: c.id,
        leadId: lead.id,
        phone: lead.phoneE164,
        session: lead.providerMessageId,
        ...r,
      });
    }
  }
  return NextResponse.json({ ok: true, refreshed: results.length, results });
}
