import { NextResponse } from "next/server";
import { guardApiRateLimit } from "@/lib/security/api-guard";
import { quoteTwilioLocalNumber } from "@/lib/twilio/inventory";

/** Live Twilio monthly rent for a local DID. Does not buy. */
export async function GET(req: Request) {
  const limited = await guardApiRateLimit(req, "lines");
  if (limited) return limited;
  const country = new URL(req.url).searchParams.get("country") ?? "US";
  const result = await quoteTwilioLocalNumber(country);
  if (!result.ok) {
    const status = result.error === "TWILIO_NOT_CONFIGURED" ? 503 : 400;
    return NextResponse.json(result, { status });
  }
  return NextResponse.json({
    ok: true,
    quote: result.quote,
    charge: result.quote.label,
  });
}
