import { NextResponse } from "next/server";
import {
  forwardScreenGatherTwiml,
  forwardScreenResultTwiml,
} from "@/lib/twilio/twiml";

/**
 * Allo leg after answer, before bridge.
 * Query: ?lead=+1…&accept=1 (accept=1 → press-1 required).
 * Twilio posts Digits when Gather finishes.
 */
export async function POST(req: Request) {
  const url = new URL(req.url);
  const leadE164 = url.searchParams.get("lead") ?? undefined;
  const requireAccept = url.searchParams.get("accept") === "1";

  const contentType = req.headers.get("content-type") ?? "";
  const params: Record<string, string> = {};
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const form = await req.formData();
    for (const [k, v] of form.entries()) {
      params[k] = String(v);
    }
  }

  if ("Digits" in params) {
    return new NextResponse(forwardScreenResultTwiml(params.Digits), {
      headers: { "content-type": "text/xml" },
    });
  }

  return new NextResponse(
    forwardScreenGatherTwiml({
      leadE164: leadE164 || params.From,
      requireAccept,
    }),
    { headers: { "content-type": "text/xml" } },
  );
}
