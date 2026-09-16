import { NextResponse } from "next/server";
import { z } from "zod";
import { lineReputationView } from "@/lib/reputation/check";
import { guardApiRateLimit } from "@/lib/security/api-guard";
import { provisionTwilioNumber } from "@/lib/twilio/inventory";

const Body = z
  .object({
    e164: z.string().min(7).optional(),
    areaCode: z.string().min(3).max(5).optional(),
    country: z.string().length(2).optional(),
    configureVoice: z.boolean().optional(),
  })
  .strict();

/**
 * Buy a Twilio DID (or import one already on the account) into the line pool.
 * Confirm with the operator first — this can charge Twilio.
 */
export async function POST(req: Request) {
  const limited = await guardApiRateLimit(req, "lines-purchase");
  if (limited) return limited;

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  if (!parsed.data.e164 && !parsed.data.areaCode) {
    return NextResponse.json(
      { error: "e164_or_area_code_required" },
      { status: 400 },
    );
  }

  const result = await provisionTwilioNumber({
    e164: parsed.data.e164,
    areaCode: parsed.data.areaCode,
    country: parsed.data.country,
    configureVoice: parsed.data.configureVoice,
  });
  if (!result.ok) {
    const status = result.error === "TWILIO_NOT_CONFIGURED" ? 503 : 400;
    return NextResponse.json(result, { status });
  }

  return NextResponse.json(
    {
      ok: true,
      purchased: result.purchased,
      imported: result.imported,
      line: { ...result.line, ...lineReputationView(result.line) },
      twilioSid: result.twilioSid,
      webhooks: result.webhooks,
    },
    { status: result.purchased ? 201 : 200 },
  );
}
