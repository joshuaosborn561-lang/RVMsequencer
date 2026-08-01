import { NextResponse } from "next/server";
import { z } from "zod";
import { getDncScrubbers, getDropCoDelivery, getElevenLabs } from "@/lib/config";
import { drainActiveCampaigns } from "@/lib/sequencer/drain";
import { runAttempt } from "@/lib/sequencer/run-attempt";

function authorizeCron(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return process.env.NODE_ENV !== "production";
  }
  const header = req.headers.get("x-cron-secret") ?? "";
  const auth = req.headers.get("authorization") ?? "";
  return header === secret || auth === `Bearer ${secret}`;
}

const SingleBody = z.object({
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
 * Sequencer tick:
 * - Cron / `{ "drain": true, "limit": N }` → drain ACTIVE campaigns from store
 * - Full lead+campaign body → single attempt (tests / manual)
 */
export async function POST(req: Request) {
  if (!authorizeCron(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const raw = await req.text();
  let json: unknown = { drain: true };
  if (raw.trim()) {
    try {
      json = JSON.parse(raw);
    } catch {
      return NextResponse.json({ error: "invalid_json" }, { status: 400 });
    }
  }

  const isSingle =
    json &&
    typeof json === "object" &&
    "lead" in json &&
    "campaign" in json;

  if (!isSingle) {
    const limit =
      json &&
      typeof json === "object" &&
      "limit" in json &&
      typeof (json as { limit: unknown }).limit === "number"
        ? Math.min(200, Math.max(1, (json as { limit: number }).limit))
        : 25;
    const result = await drainActiveCampaigns(limit);
    return NextResponse.json({ mode: "drain", ...result });
  }

  const parsed = SingleBody.safeParse(json);
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

  return NextResponse.json({ mode: "single", ...result });
}
