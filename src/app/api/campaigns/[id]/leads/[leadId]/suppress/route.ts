import { NextResponse } from "next/server";
import { z } from "zod";
import { guardApiRateLimit, guardCronAuth } from "@/lib/security/api-guard";
import { suppressCampaignLead } from "@/lib/store/db";

type Ctx = { params: Promise<{ id: string; leadId: string }> };

const Body = z
  .object({
    reason: z.string().trim().min(1).max(120).optional(),
  })
  .strict();

/**
 * Narrow operator cleanup: suppress one campaign lead and cancel its
 * unsent queue rows. Auth: CRON_SECRET. Does not bulk-replace or
 * rewrite SENT / FAILED history.
 */
export async function POST(req: Request, ctx: Ctx) {
  const denied = guardCronAuth(req);
  if (denied) return denied;
  const limited = await guardApiRateLimit(req, "leads");
  if (limited) return limited;

  const { id, leadId } = await ctx.params;
  let json: unknown = {};
  try {
    json = await req.json();
  } catch {
    json = {};
  }
  const parsed = Body.safeParse(json ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const result = await suppressCampaignLead(id, leadId, {
    reason: parsed.data.reason ?? "LANE_MISMATCH",
    actor: "api",
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    lead: result.lead,
    cancelledScheduled: result.cancelledScheduled,
    idempotent: result.idempotent,
    historyPreserved: result.historyPreserved,
    ...(result.historyPreserved ? { skipped: "already_sent" as const } : {}),
  });
}
