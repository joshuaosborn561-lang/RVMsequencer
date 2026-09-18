import { isSupabaseConfigured, supabaseRpc, supabaseRest } from "@/lib/supabase/config";
import { isPermanent, type Destination, type DestinationApplyResult, type ResolvedIdentity, type SuppressionEvent } from "../types";

export const centralDestination: Destination = {
  id: "central",
  configured: isSupabaseConfigured,
  apply: applyCentral,
};

export async function applyCentral(
  event: SuppressionEvent,
  identity: ResolvedIdentity,
): Promise<DestinationApplyResult> {
  if (!isSupabaseConfigured()) {
    return { status: "failed", error: "supabase_not_configured" };
  }
  const email = identity.email;
  const domain = identity.domain;
  const phone = identity.phoneE164 ?? event.phoneE164;
  if (!email && !domain && !phone) {
    return { status: "skipped", reason: "no_identity" };
  }

  const permanent = isPermanent(event.outcome);
  const firstSeen = event.occurredAt.slice(0, 10);
  const res = await supabaseRpc<string>("upsert_outreach_suppression", {
    p_email: email ?? null,
    p_email_domain: domain ?? null,
    p_phone_e164: phone ?? null,
    p_first_name: identity.firstName ?? null,
    p_last_name: identity.lastName ?? null,
    p_company: identity.company ?? null,
    p_reason: event.reason,
    p_source: `rvm_${event.source}`,
    p_outcome: event.outcome,
    p_source_channel: event.source,
    p_source_event_id: event.id,
    p_allo_call_id: event.alloCallId ?? null,
    p_allo_rep: event.alloRep ?? null,
    p_recording_url: event.recordingUrl ?? null,
    p_permanent: permanent,
    p_first_seen: firstSeen,
  });

  if (!res.ok) {
    const msg =
      typeof res.body === "object" && res.body && "message" in res.body
        ? String((res.body as { message?: string }).message)
        : `supabase_${res.status}`;
    return { status: "failed", error: msg.slice(0, 180) };
  }

  if (permanent && domain) {
    await supabaseRest("sg_engager_suppression?on_conflict=domain", {
      method: "POST",
      prefer: "resolution=merge-duplicates,return=minimal",
      body: JSON.stringify([
        { domain, reason: event.reason, added_at: new Date().toISOString() },
      ]),
    }).catch(() => undefined);
  }

  return { status: "ok" };
}
