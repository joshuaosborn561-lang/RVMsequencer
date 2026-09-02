import { NextResponse } from "next/server";
import { z } from "zod";
import { toE164 } from "@/lib/phone";
import { lineReputationView } from "@/lib/reputation/check";
import { ensureLine, listLines, updateLine } from "@/lib/store/db";
import { configureTwilioNumberWebhooks } from "@/lib/twilio/configure-number";

export async function GET() {
  const lines = await listLines();
  return NextResponse.json({
    lines: lines.map((line) => ({
      ...line,
      ...lineReputationView(line),
    })),
  });
}

const PostBody = z.object({
  e164: z.string().min(7),
  /** When true (default), set Twilio VoiceUrl/SmsUrl to RVM Drop webhooks */
  configureVoice: z.boolean().optional(),
});

export async function POST(req: Request) {
  const parsed = PostBody.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const e164 = toE164(parsed.data.e164);
  if (!e164) {
    return NextResponse.json(
      { error: "invalid_phone", hint: "Use US/CA 10-digit or E.164" },
      { status: 400 },
    );
  }
  const line = await ensureLine(e164);
  let twilio: Awaited<ReturnType<typeof configureTwilioNumberWebhooks>> | undefined;
  if (parsed.data.configureVoice !== false) {
    twilio = await configureTwilioNumberWebhooks({ e164 });
  }
  return NextResponse.json(
    { line: { ...line, ...lineReputationView(line) }, twilio },
    { status: 201 },
  );
}

const PatchBody = z.object({
  id: z.string().optional(),
  e164: z.string().optional(),
  dailyCap: z.number().int().min(0).max(10_000).optional(),
  status: z
    .enum(["PROVISIONING", "WARMING", "HEALTHY", "DEGRADED", "QUARANTINED", "RETIRED"])
    .optional(),
  warmupDay: z.number().int().min(0).max(90).optional(),
  minGapSec: z.number().int().min(0).max(86_400).optional(),
  reputationLabel: z
    .enum(["UNFLAGGED", "MIXED_LOW", "MIXED_HIGH", "FLAGGED", "UNKNOWN"])
    .optional(),
  reputationSource: z.enum(["calltracer", "hiya", "manual"]).optional(),
  registeredFcr: z.boolean().optional(),
  /** Re-point Twilio VoiceUrl to this app */
  configureVoice: z.boolean().optional(),
});

/** Update per-DID daily cap / status (Claude walkthrough uses this). */
export async function PATCH(req: Request) {
  const parsed = PatchBody.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const key = parsed.data.id || parsed.data.e164;
  if (!key) {
    return NextResponse.json(
      { error: "id_or_e164_required" },
      { status: 400 },
    );
  }
  const line = await updateLine(key, {
    dailyCap: parsed.data.dailyCap,
    status: parsed.data.status,
    warmupDay: parsed.data.warmupDay,
    minGapSec: parsed.data.minGapSec,
    reputationLabel: parsed.data.reputationLabel,
    reputationSource:
      parsed.data.reputationLabel != null
        ? (parsed.data.reputationSource ?? "manual")
        : parsed.data.reputationSource,
    registeredFcr: parsed.data.registeredFcr,
  });
  if (!line) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (parsed.data.registeredFcr != null) {
    const { appendAudit } = await import("@/lib/store/db");
    await appendAudit({
      action: "FCR_UPDATED",
      actor: "api",
      entityType: "line",
      entityId: line.id,
      detail: { e164: line.e164, registeredFcr: line.registeredFcr },
    });
  }
  let twilio: Awaited<ReturnType<typeof configureTwilioNumberWebhooks>> | undefined;
  if (parsed.data.configureVoice) {
    twilio = await configureTwilioNumberWebhooks({ e164: line.e164 });
  }
  return NextResponse.json({ line: { ...line, ...lineReputationView(line) }, twilio });
}
