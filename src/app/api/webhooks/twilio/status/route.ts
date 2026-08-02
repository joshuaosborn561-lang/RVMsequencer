import { NextResponse } from "next/server";
import { reconcileProviderDelivery } from "@/lib/sequencer/reconcile-delivery";
import {
  isValidTwilioSignature,
  twilioAuthConfigured,
} from "@/lib/twilio/validate";

/**
 * Twilio call status callback → delivery ledger.
 * Map CallStatus onto attempt outcomes (AMD / voice path).
 */
export async function POST(req: Request) {
  const contentType = req.headers.get("content-type") ?? "";
  const params: Record<string, string> = {};

  if (contentType.includes("application/x-www-form-urlencoded")) {
    const form = await req.formData();
    for (const [k, v] of form.entries()) params[k] = String(v);
  } else {
    const json = (await req.json().catch(() => ({}))) as Record<string, string>;
    Object.assign(params, json);
  }

  if (twilioAuthConfigured() && contentType.includes("application/x-www-form-urlencoded")) {
    const signature = req.headers.get("x-twilio-signature");
    const url = process.env.NEXT_PUBLIC_APP_URL
      ? `${process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "")}/api/webhooks/twilio/status`
      : req.url;
    const ok = isValidTwilioSignature({
      authToken: process.env.TWILIO_AUTH_TOKEN!,
      signature,
      url,
      params,
    });
    if (!ok && process.env.NODE_ENV === "production") {
      return new NextResponse("invalid signature", { status: 403 });
    }
  }

  const callSid = params.CallSid ?? params.CallSid;
  const callStatus = (params.CallStatus ?? "").toLowerCase();
  const foreignId = params.foreignId ?? params.ForeignId;

  let status:
    | "queued"
    | "sent"
    | "delivered"
    | "failed"
    | "rejected"
    | "human_answered" = "sent";

  if (callStatus === "completed" || callStatus === "answered") {
    status = "delivered";
  } else if (
    callStatus === "busy" ||
    callStatus === "no-answer" ||
    callStatus === "canceled" ||
    callStatus === "failed"
  ) {
    status = "failed";
  } else if (params.AnsweredBy === "human") {
    status = "human_answered";
  }

  const result = await reconcileProviderDelivery({
    provider: "TWILIO",
    providerMessageId: callSid,
    foreignId,
    status,
    errorDetail: params.ErrorMessage,
    raw: params,
  });

  return NextResponse.json(result, { status: result.ok ? 200 : 404 });
}
