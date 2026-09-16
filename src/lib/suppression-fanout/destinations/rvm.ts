import { getSuppression, suppressLeadByPhone } from "@/lib/store/db";
import type { Destination, DestinationApplyResult, SuppressionEvent } from "../types";
import { isPermanent } from "../types";
import type { ResolvedIdentity } from "../types";

export const rvmDestination: Destination = {
  id: "rvm",
  configured: () => true,
  apply: applyRvm,
};

export async function applyRvm(
  event: SuppressionEvent,
  identity: ResolvedIdentity,
): Promise<DestinationApplyResult> {
  const phone = identity.phoneE164 ?? event.phoneE164;
  if (!phone) return { status: "skipped", reason: "no_phone" };
  if (event.source === "rvm") return { status: "ok" };

  const existing = await getSuppression(phone);
  const wantDnc = isPermanent(event.outcome);
  if (existing && (!wantDnc || existing.reason === "allo_dnc" || existing.source === "ALLO")) {
    return { status: "ok" };
  }

  await suppressLeadByPhone(phone, event.reason, {
    source: event.source === "allo" ? "ALLO" : event.source === "smartlead" ? "SMARTLEAD" : "MANUAL",
    markDnc: wantDnc,
    optOut: wantDnc && event.source !== "allo",
  });
  return { status: "ok" };
}
