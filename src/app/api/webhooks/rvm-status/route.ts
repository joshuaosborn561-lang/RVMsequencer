import { NextResponse } from "next/server";
import { z } from "zod";
import { reconcileProviderDelivery } from "@/lib/sequencer/reconcile-delivery";
import type { ProviderDeliveryEvent } from "@/lib/sequencer/reconcile-delivery";

/**
 * Provider delivery status → attempt ledger.
 *
 * Accepts:
 * - Normalized body (our shape; default provider SLYBROADCAST)
 * - Legacy Drop Cowboy-shaped payloads ({ drop_id, foreign_id, status: success|failure })
 *   still parsed for historical webhooks — not an active delivery path.
 *
 * Auth: Bearer / x-webhook-secret = RVM_STATUS_WEBHOOK_SECRET
 */
function authorize(req: Request): boolean {
  const secret = process.env.RVM_STATUS_WEBHOOK_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  const header = req.headers.get("x-webhook-secret") ?? "";
  const auth = req.headers.get("authorization") ?? "";
  const urlSecret = new URL(req.url).searchParams.get("secret") ?? "";
  return (
    header === secret ||
    auth === `Bearer ${secret}` ||
    urlSecret === secret
  );
}

const NormalizedStatus = z.enum([
  "queued",
  "sent",
  "delivered",
  "failed",
  "rejected",
  "human_answered",
]);

function mapLegacySuccessFailure(
  status: string,
  reason?: string,
): ProviderDeliveryEvent["status"] {
  const s = status.toLowerCase();
  if (s === "success" || s === "delivered" || s === "sent") return "delivered";
  if (s === "pending" || s === "queued") return "queued";
  if (s === "failure" || s === "failed" || s === "error") {
    if (reason && /spam|denied|rejected/i.test(reason)) return "rejected";
    return "failed";
  }
  return "failed";
}

export async function POST(req: Request) {
  if (!authorize(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const raw = (await req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!raw || typeof raw !== "object") {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  // Legacy success/failure shape (historical Drop Cowboy webhooks)
  const isLegacySuccessFailure =
    ("drop_id" in raw || "foreign_id" in raw) &&
    typeof raw.status === "string" &&
    !NormalizedStatus.safeParse(raw.status).success;

  let event: ProviderDeliveryEvent;

  if (isLegacySuccessFailure) {
    const status = String(raw.status);
    const reason =
      typeof raw.reason === "string" ? raw.reason : undefined;
    event = {
      provider: "UNKNOWN",
      providerMessageId:
        typeof raw.drop_id === "string" ? raw.drop_id : undefined,
      foreignId:
        typeof raw.foreign_id === "string" ? raw.foreign_id : undefined,
      status: mapLegacySuccessFailure(status, reason),
      errorDetail: reason || undefined,
      raw,
    };
    if (raw.dnc === true) {
      event.status = "rejected";
      event.errorDetail = event.errorDetail
        ? `${event.errorDetail};DNC`
        : "DNC";
    }
  } else {
    const Body = z.object({
      provider: z
        .enum(["DROP_CO", "TWILIO", "SLYBROADCAST", "UNKNOWN"])
        .optional()
        .default("SLYBROADCAST"),
      providerMessageId: z.string().optional(),
      ActivityToken: z.string().optional(),
      drop_id: z.string().optional(),
      foreignId: z.string().optional(),
      ForeignId: z.string().optional(),
      foreign_id: z.string().optional(),
      status: NormalizedStatus,
      errorDetail: z.string().optional(),
      reason: z.string().optional(),
    });
    const parsed = Body.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    event = {
      provider: parsed.data.provider,
      providerMessageId:
        parsed.data.providerMessageId ??
        parsed.data.drop_id ??
        parsed.data.ActivityToken,
      foreignId:
        parsed.data.foreignId ??
        parsed.data.foreign_id ??
        parsed.data.ForeignId,
      status: parsed.data.status,
      errorDetail: parsed.data.errorDetail ?? parsed.data.reason,
      raw,
    };
  }

  const result = await reconcileProviderDelivery(event);
  if (!result.ok) {
    return NextResponse.json(result, { status: 404 });
  }
  return NextResponse.json(result);
}
