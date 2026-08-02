import { NextResponse } from "next/server";
import { z } from "zod";
import { reconcileProviderDelivery } from "@/lib/sequencer/reconcile-delivery";

/**
 * Provider delivery status → attempt ledger.
 * Auth: Bearer / x-webhook-secret = RVM_STATUS_WEBHOOK_SECRET
 */
function authorize(req: Request): boolean {
  const secret = process.env.RVM_STATUS_WEBHOOK_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  const header = req.headers.get("x-webhook-secret") ?? "";
  const auth = req.headers.get("authorization") ?? "";
  return header === secret || auth === `Bearer ${secret}`;
}

const Body = z.object({
  provider: z
    .enum(["DROP_CO", "TWILIO", "SLYBROADCAST", "UNKNOWN"])
    .optional()
    .default("UNKNOWN"),
  providerMessageId: z.string().optional(),
  ActivityToken: z.string().optional(),
  foreignId: z.string().optional(),
  ForeignId: z.string().optional(),
  status: z.enum([
    "queued",
    "sent",
    "delivered",
    "failed",
    "rejected",
    "human_answered",
  ]),
  errorDetail: z.string().optional(),
});

export async function POST(req: Request) {
  if (!authorize(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const raw = await req.json().catch(() => null);
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const result = await reconcileProviderDelivery({
    provider: parsed.data.provider,
    providerMessageId:
      parsed.data.providerMessageId ?? parsed.data.ActivityToken,
    foreignId: parsed.data.foreignId ?? parsed.data.ForeignId,
    status: parsed.data.status,
    errorDetail: parsed.data.errorDetail,
    raw,
  });

  if (!result.ok) {
    return NextResponse.json(result, { status: 404 });
  }
  return NextResponse.json(result);
}
