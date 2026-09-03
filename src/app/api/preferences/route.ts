import { NextResponse } from "next/server";
import { z } from "zod";
import { getPreferences, updatePreferences } from "@/lib/store/db";

export async function GET() {
  const preferences = await getPreferences();
  return NextResponse.json({ preferences });
}

const Body = z.object({
  defaultClientId: z.string().optional().nullable(),
  defaultLineIds: z.array(z.string()).optional(),
  defaultAudioUrl: z.string().optional().nullable(),
  defaultAudioAssetId: z.string().optional().nullable(),
  defaultNewLeadsPerDay: z.number().int().min(1).max(100_000).optional(),
  defaultHardCapDailySends: z.number().int().min(1).max(100_000).optional(),
  defaultLineDailyCap: z.number().int().min(0).max(10_000).optional(),
  defaultSchedule: z
    .object({
      sendWindowStart: z.number().int().min(0).max(23).optional(),
      sendWindowEnd: z.number().int().min(1).max(24).optional(),
      fridaySendWindowStart: z.number().int().min(0).max(23).nullable().optional(),
      fridaySendWindowEnd: z.number().int().min(1).max(24).nullable().optional(),
      sendDays: z.array(z.number().int().min(0).max(6)).optional(),
      timezoneMode: z.enum(["RECIPIENT_LOCAL", "FIXED"]).optional(),
      fixedTimezone: z.string().optional(),
      requireConsent: z.boolean().optional(),
      stopOnCallback: z.boolean().optional(),
      stopOnOptOut: z.boolean().optional(),
    })
    .optional(),
  lastCampaignId: z.string().optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});

/**
 * Persist Claude skill defaults (lines, audio, schedule, caps)
 * so the next chat can skip the full walkthrough.
 */
export async function PATCH(req: Request) {
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const patch = { ...parsed.data } as Record<string, unknown>;
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) patch[k] = "";
  }

  const preferences = await updatePreferences(patch as Parameters<typeof updatePreferences>[0]);
  return NextResponse.json({ preferences });
}
