import { NextResponse } from "next/server";
import { z } from "zod";
import { toE164 } from "@/lib/phone";
import {
  getSettings,
  resolveCallForwardTo,
  updateSettings,
} from "@/lib/store/db";

export async function GET() {
  const settings = await getSettings();
  const forward = await resolveCallForwardTo();
  return NextResponse.json({
    settings,
    effective: {
      callForwardToE164: forward.e164,
      callForwardTimeoutSec: forward.timeoutSec,
      source: forward.source,
    },
  });
}

const Body = z.object({
  callForwardToE164: z.union([z.string(), z.null()]).optional(),
  callForwardTimeoutSec: z.number().int().min(5).max(120).optional(),
  callForwardRequireAccept: z.boolean().optional(),
  hardCapDailySends: z.number().int().min(1).max(100_000).optional(),
  lineMinGapSec: z.number().int().min(0).max(86_400).optional(),
  requireFcrRegistration: z.boolean().optional(),
  maxAttemptsPerContactPerDay: z.number().int().min(1).max(20).optional(),
  seedInjectPerCampaignPerDay: z.number().int().min(0).max(50).optional(),
});

export async function PATCH(req: Request) {
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const patch: {
    callForwardToE164?: string;
    callForwardTimeoutSec?: number;
    callForwardRequireAccept?: boolean;
    hardCapDailySends?: number;
    lineMinGapSec?: number;
    requireFcrRegistration?: boolean;
    maxAttemptsPerContactPerDay?: number;
    seedInjectPerCampaignPerDay?: number;
  } = {};

  if (parsed.data.callForwardTimeoutSec != null) {
    patch.callForwardTimeoutSec = parsed.data.callForwardTimeoutSec;
  }
  if (parsed.data.callForwardRequireAccept != null) {
    patch.callForwardRequireAccept = parsed.data.callForwardRequireAccept;
  }
  if (parsed.data.hardCapDailySends != null) {
    patch.hardCapDailySends = parsed.data.hardCapDailySends;
  }
  if (parsed.data.lineMinGapSec != null) {
    patch.lineMinGapSec = parsed.data.lineMinGapSec;
  }
  if (parsed.data.requireFcrRegistration != null) {
    patch.requireFcrRegistration = parsed.data.requireFcrRegistration;
  }
  if (parsed.data.maxAttemptsPerContactPerDay != null) {
    patch.maxAttemptsPerContactPerDay = parsed.data.maxAttemptsPerContactPerDay;
  }
  if (parsed.data.seedInjectPerCampaignPerDay != null) {
    patch.seedInjectPerCampaignPerDay = parsed.data.seedInjectPerCampaignPerDay;
  }

  if (parsed.data.callForwardToE164 !== undefined) {
    if (
      parsed.data.callForwardToE164 === null ||
      parsed.data.callForwardToE164.trim() === ""
    ) {
      patch.callForwardToE164 = "";
    } else {
      const e164 = toE164(parsed.data.callForwardToE164);
      if (!e164) {
        return NextResponse.json(
          { error: "invalid_phone", hint: "Use US/CA 10-digit or E.164" },
          { status: 400 },
        );
      }
      patch.callForwardToE164 = e164;
    }
  }

  const settings = await updateSettings(patch);
  const forward = await resolveCallForwardTo();
  return NextResponse.json({
    settings,
    effective: {
      callForwardToE164: forward.e164,
      callForwardTimeoutSec: forward.timeoutSec,
      source: forward.source,
    },
  });
}
