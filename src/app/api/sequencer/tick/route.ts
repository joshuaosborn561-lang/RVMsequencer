import { NextResponse } from "next/server";
import { z } from "zod";
import { getDncScrubbers, getDefaultDelivery } from "@/lib/config";
import {
  checkRateLimit,
  clientKeyFromRequest,
} from "@/lib/security/rate-limit";
import { runDailyReputationChecks } from "@/lib/reputation/run-daily";
import {
  drainActiveCampaigns,
  reconcileCampaigns,
} from "@/lib/sequencer/drain";
import { runAttempt } from "@/lib/sequencer/run-attempt";
import { isSuppressed } from "@/lib/store/db";
import { runAlloSuppressionSync } from "@/lib/allo/sync";
import { isAlloSyncEnabled } from "@/lib/allo/client";

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
    postalCode: z.string().optional().nullable(),
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
      warmupDay: z.number().int().optional(),
      lastSentAt: z.string().optional().nullable(),
      minGapSec: z.number().int().optional(),
    }),
  ),
  stickyLineId: z.string().optional(),
  internalBlocked: z.array(z.string()).optional(),
});

/**
 * Sequencer tick:
 * - Cron / `{ "drain": true, "limit": N }` → reconcile + drain ACTIVE campaigns
 * - Full lead+campaign body → single attempt (tests / manual)
 */
export async function POST(req: Request) {
  if (!authorizeCron(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const rl = await checkRateLimit(`cron:${clientKeyFromRequest(req)}`, {
    windowMs: 60_000,
    max: 60,
  });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "rate_limited", retryAfterSec: rl.retryAfterSec },
      { status: 429, headers: { "retry-after": String(rl.retryAfterSec) } },
    );
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
    const forceReputation =
      Boolean(
        json &&
          typeof json === "object" &&
          (json as { forceReputation?: unknown }).forceReputation === true,
      );
    // Once-daily spam/blacklist pass (no-op if already ran ~today unless forced)
    const reputation = await runDailyReputationChecks({
      force: forceReputation,
    });
    // Hourly Allo → suppression sync (gated inside; never blocks drain on failure)
    let alloSync: unknown = { ran: false, skippedReason: "disabled" };
    if (isAlloSyncEnabled()) {
      try {
        alloSync = await runAlloSuppressionSync();
      } catch (err) {
        console.error("[tick] allo suppression sync failed", err);
        alloSync = {
          ran: false,
          skippedReason: "error",
          error: err instanceof Error ? err.message : "unknown",
        };
      }
    }
    const reconcile = await reconcileCampaigns();
    const result = await drainActiveCampaigns(limit);
    return NextResponse.json({
      mode: "drain",
      reputation,
      alloSync,
      reconcile,
      ...result,
    });
  }

  const parsed = SingleBody.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { lead, campaign, lines, stickyLineId, internalBlocked } = parsed.data;
  const result = await runAttempt({
    lead,
    campaign,
    lines,
    stickyLineId,
    dncScrubbers: getDncScrubbers(internalBlocked ?? []),
    delivery: getDefaultDelivery(),
    isSuppressed: (phone) => isSuppressed(phone),
  });

  return NextResponse.json({ mode: "single", ...result });
}
