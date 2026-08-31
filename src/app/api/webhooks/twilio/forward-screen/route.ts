import { NextResponse } from "next/server";
import {
  forwardScreenGatherTwiml,
  forwardScreenResultTwiml,
} from "@/lib/twilio/twiml";

/**
 * Runs on the Allo / forward-leg after answer, before bridge.
 * Humans press 1; Allo voicemail cannot → Hangup (lead never lands in VM).
 */
export async function POST(req: Request) {
  const contentType = req.headers.get("content-type") ?? "";
  const params: Record<string, string> = {};
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const form = await req.formData();
    for (const [k, v] of form.entries()) {
      params[k] = String(v);
    }
  }

  // Twilio posts Digits when Gather finishes (same URL when action omitted).
  if ("Digits" in params) {
    return new NextResponse(forwardScreenResultTwiml(params.Digits), {
      headers: { "content-type": "text/xml" },
    });
  }

  return new NextResponse(
    forwardScreenGatherTwiml({ leadE164: params.From }),
    { headers: { "content-type": "text/xml" } },
  );
}
