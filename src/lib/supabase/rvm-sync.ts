/**
 * Sync RVM drops + callbacks to Supabase Campaign Intelligence
 * (same project as Smartlead/maps data — isolated tables only: rvm_drops, rvm_callbacks).
 */
function supabaseConfig(): { url: string; key: string } | null {
  const url = process.env.SUPABASE_URL?.trim();
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.SUPABASE_ANON_KEY?.trim();
  if (!url || !key) return null;
  return { url: url.replace(/\/$/, ""), key };
}

async function sbFetch(
  path: string,
  init: RequestInit & { prefer?: string } = {},
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const cfg = supabaseConfig();
  if (!cfg) return { ok: false, status: 0, body: { error: "SUPABASE_NOT_CONFIGURED" } };
  const headers: Record<string, string> = {
    apikey: cfg.key,
    Authorization: `Bearer ${cfg.key}`,
    "Content-Type": "application/json",
    ...(init.prefer ? { Prefer: init.prefer } : {}),
  };
  const res = await fetch(`${cfg.url}/rest/v1/${path}`, {
    ...init,
    headers: { ...headers, ...(init.headers as Record<string, string> | undefined) },
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* keep text */
  }
  return { ok: res.ok, status: res.status, body };
}

export type RvmDropRow = {
  campaign_id?: string;
  campaign_name?: string;
  client_id?: string;
  client_name?: string;
  lead_id?: string;
  lead_phone: string;
  from_did?: string;
  audio_url?: string;
  provider?: string;
  provider_session_id?: string;
  queued_at?: string;
  dial_status?: string;
  fail_reason?: string;
  carrier?: string;
  delivery_time?: string;
  app_lead_status?: string;
  raw?: Record<string, unknown>;
};

export async function upsertRvmDrop(row: RvmDropRow) {
  if (!supabaseConfig()) return { skipped: true as const };
  // PostgREST upsert on provider_session_id when present
  if (row.provider_session_id) {
    return sbFetch("rvm_drops?on_conflict=provider_session_id", {
      method: "POST",
      prefer: "resolution=merge-duplicates,return=representation",
      body: JSON.stringify([{ ...row, updated_at: new Date().toISOString() }]),
    });
  }
  return sbFetch("rvm_drops", {
    method: "POST",
    prefer: "return=representation",
    body: JSON.stringify([{ ...row, updated_at: new Date().toISOString() }]),
  });
}

export async function updateRvmDropBySession(
  sessionId: string,
  patch: Partial<RvmDropRow>,
) {
  if (!supabaseConfig()) return { skipped: true as const };
  return sbFetch(`rvm_drops?provider_session_id=eq.${encodeURIComponent(sessionId)}`, {
    method: "PATCH",
    prefer: "return=representation",
    body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
  });
}

export type RvmCallbackRow = {
  call_sid?: string;
  message_sid?: string;
  from_phone: string;
  to_did: string;
  forward_to?: string;
  channel?: string;
  category?: string;
  body?: string;
  related_drop_id?: string;
  client_id?: string;
  client_name?: string;
  campaign_id?: string;
  raw?: Record<string, unknown>;
};

export async function insertRvmCallback(row: RvmCallbackRow) {
  if (!supabaseConfig()) return { skipped: true as const };
  if (row.call_sid) {
    return sbFetch("rvm_callbacks?on_conflict=call_sid", {
      method: "POST",
      prefer: "resolution=merge-duplicates,return=representation",
      body: JSON.stringify([row]),
    });
  }
  return sbFetch("rvm_callbacks", {
    method: "POST",
    prefer: "return=representation",
    body: JSON.stringify([row]),
  });
}

/** Pull Slybroadcast campaign_result and patch dial_status / fail_reason / carrier. */
export async function refreshSlybroadcastOutcome(sessionId: string) {
  const uid = process.env.SLYBROADCAST_UID?.trim();
  const password = process.env.SLYBROADCAST_PASSWORD?.trim();
  if (!uid || !password) return { ok: false, error: "SLYBROADCAST_NOT_CONFIGURED" };

  const body = new URLSearchParams({
    c_uid: uid,
    c_password: password,
    c_option: "campaign_result",
    session_id: sessionId,
  });
  const res = await fetch("https://www.slybroadcast.com/gateway/vmb.json.php", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const raw: unknown = await res.json().catch(() => null);
  const row = Array.isArray(raw) ? raw[0] : raw;
  if (!row || typeof row !== "object") return { ok: false, error: "empty", raw };

  const r = row as Record<string, unknown>;
  const dialStatus = String(r["dial status"] ?? r.dial_status ?? "");
  const failReason = String(r["fail reason"] ?? r.fail_reason ?? "");
  const carrier = String(r.carrier ?? "");
  const deliveryTime = String(r["delivery time"] ?? r.delivery_time ?? "");
  const toPhone = String(r["to phone"] ?? r.destination ?? "");

  await updateRvmDropBySession(sessionId, {
    dial_status: dialStatus || undefined,
    fail_reason: failReason || undefined,
    carrier: carrier || undefined,
    delivery_time: deliveryTime || undefined,
    lead_phone: toPhone ? (toPhone.startsWith("+") ? toPhone : `+1${toPhone.replace(/\D/g, "")}`) : undefined,
    raw: { slybroadcast: r },
  });

  return { ok: true, dialStatus, failReason, carrier, raw: r };
}
