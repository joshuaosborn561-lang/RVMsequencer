import { NextResponse } from "next/server";
import { guardApiRateLimit } from "@/lib/security/api-guard";
import { listLines } from "@/lib/store/db";
import {
  listOwnedTwilioNumbers,
  searchAvailableTwilioNumbers,
} from "@/lib/twilio/inventory";

export async function GET(req: Request) {
  const limited = await guardApiRateLimit(req, "lines");
  if (limited) return limited;

  const url = new URL(req.url);
  const source = url.searchParams.get("source") === "account" ? "account" : "available";
  const areaCode = url.searchParams.get("areaCode") ?? undefined;
  const contains = url.searchParams.get("contains") ?? undefined;
  const locality = url.searchParams.get("locality") ?? undefined;
  const region = url.searchParams.get("region") ?? undefined;
  const country = url.searchParams.get("country") ?? undefined;
  const limitRaw = url.searchParams.get("limit");
  const limit = limitRaw ? Number(limitRaw) : undefined;

  const result =
    source === "account"
      ? await listOwnedTwilioNumbers({ areaCode, limit })
      : await searchAvailableTwilioNumbers({
          country,
          areaCode,
          contains,
          locality,
          region,
          limit,
        });
  if (!result.ok) {
    const status = result.error === "TWILIO_NOT_CONFIGURED" ? 503 : 400;
    return NextResponse.json(result, { status });
  }

  const pool = new Set((await listLines()).map((l) => l.e164));
  return NextResponse.json({
    source,
    quote: "quote" in result ? result.quote : undefined,
    numbers: result.numbers.map((n) => ({
      ...n,
      inPool: pool.has(n.e164),
    })),
  });
}
