import { NextResponse } from "next/server";
import { z } from "zod";
import { getDefaultDelivery, getDncScrubbers } from "@/lib/config";
import { drainActiveCampaigns, reconcileCampaigns } from "@/lib/sequencer/drain";
import {
  getCampaign,
  listLeads,
  updateCampaign,
} from "@/lib/store/db";
import {
  eagerScheduleCampaign,
  listScheduledForCampaign,
  updateScheduledSend,
} from "@/lib/store/scheduled";

type Ctx = { params: Promise<{ id: string }> };

const Body = z.object({
  audioUrl: z.string().url().optional(),
  limit: z.number().int().min(1).max(50).optional(),
});

/**
 * Activate campaign + drain immediately (UI "Drop now" for tests).
 * Bypasses humanize jitter so a single test lead actually sends now.
 */
export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const existing = await getCampaign(id);
  if (!existing) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const audioUrl = parsed.data.audioUrl || existing.audioUrl;
  const leads = await listLeads(id);
  const sendable = leads.filter(
    (l) =>
      !l.dnc &&
      l.consentStatus !== "OPTED_OUT" &&
      (l.status ?? "PENDING") !== "SUPPRESSED" &&
      (l.status ?? "PENDING") !== "SENT",
  );

  const blockers: string[] = [];
  if (sendable.length === 0) blockers.push("no_sendable_leads");
  if (existing.lineIds.length === 0) blockers.push("no_lines");
  if (!audioUrl) blockers.push("no_audio_url");
  if (!existing.schedule.sendDays.length) blockers.push("no_send_days");
  if (blockers.length) {
    return NextResponse.json(
      { error: "launch_blocked", blockers },
      { status: 400 },
    );
  }

  const campaign = await updateCampaign(id, {
    status: "ACTIVE",
    audioUrl,
  });
  if (!campaign) {
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }

  const scheduled = await eagerScheduleCampaign({ campaign, leads });

  // Pull any jitter-deferred rows due now so send-now actually fires.
  const nowIso = new Date().toISOString();
  const queue = await listScheduledForCampaign(id);
  let reset = 0;
  for (const s of queue) {
    if (s.status === "SENT" || s.status === "CANCELLED") continue;
    await updateScheduledSend(s.id, {
      status: "PENDING",
      runAt: nowIso,
      claimOwner: undefined,
      claimedAt: undefined,
      lastError: undefined,
    });
    reset += 1;
  }

  await reconcileCampaigns();
  const drain = await drainActiveCampaigns(parsed.data.limit ?? 10, {
    immediate: true,
  });

  return NextResponse.json({
    ok: true,
    campaign,
    scheduled,
    resetDue: reset,
    drain,
    delivery: getDefaultDelivery().id,
    scrubbers: getDncScrubbers().length,
  });
}
