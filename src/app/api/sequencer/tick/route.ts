import { NextResponse } from "next/server";
import { z } from "zod";
import { runAttempt } from "@/lib/sequencer/run-attempt";
import { getDncScrubbers, getDropCoDelivery, getElevenLabs } from "@/lib/config";

const Body = z.object({
  lead: z.object({
    id: z.string(),
    phoneE164: z.string(),
    firstName: z.string().optional().nullable(),
    lastName: z.string().optional().nullable(),
    company: z.string().optional().nullable(),
    timezone: z.string().optional().nullable(),
    consentStatus: z.enum([
      "UNKNOWN",
      "EXPRESS_WRITTEN",
      "EXPRESS_ORAL",
      "ESTABLISHED_BUSINESS",
      "OPTED_OUT",
    ]),
    dnc: z.boolean(),
  }),
  campaign: z.object({
    id: z.string(),
    scriptTemplate: z.string(),
    audioUrl: z.string().url().optional().nullable(),
    elevenVoiceId: z.string().optional().nullable(),
    dropCoCampaignToken: z.string().optional().nullable(),
    schedule: z.object({
      sendWindowStart: z.number().int().min(0).max(23),
      sendWindowEnd: z.number().int().min(1).max(24),
      sendDays: z.array(z.number().int().min(0).max(6)).min(1),
      requireConsent: z.boolean().optional(),
    }),
  }),
  lines: z.array(
    z.object({
      id: z.string(),
      e164: z.string(),
      areaCode: z.string().optional().nullable(),
      status: z.enum([
        "PROVISIONING",
        "WARMING",
        "HEALTHY",
        "DEGRADED",
        "QUARANTINED",
        "RETIRED",
      ]),
      dailyCap: z.number().int(),
      sentToday: z.number().int(),
      reputationLabel: z.enum([
        "UNFLAGGED",
        "MIXED_LOW",
        "MIXED_HIGH",
        "FLAGGED",
        "UNKNOWN",
      ]),
    }),
  ),
  internalBlocked: z.array(z.string()).optional(),
});

/**
 * Process one enrollment tick:
 * scrub → recipient-local window → line pick → audio → Drop.co.
 */
export async function POST(req: Request) {
  const json: unknown = await req.json();
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { lead, campaign, lines, internalBlocked } = parsed.data;
  const result = await runAttempt({
    lead,
    campaign,
    lines,
    dncScrubbers: getDncScrubbers(internalBlocked ?? []),
    delivery: getDropCoDelivery(campaign.dropCoCampaignToken),
    voice: process.env.ELEVENLABS_API_KEY ? getElevenLabs() : undefined,
  });

  return NextResponse.json(result);
}
