export type SupabaseConfig = { url: string; key: string };

export function getSupabaseConfig(): SupabaseConfig | null {
  const url = process.env.SUPABASE_URL?.trim();
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.SUPABASE_ANON_KEY?.trim();
  if (!url || !key) return null;
  return { url: url.replace(/\/$/, ""), key };
}

export function isSupabaseConfigured(): boolean {
  return getSupabaseConfig() != null;
}

export async function supabaseRest(
  path: string,
  init: RequestInit & { prefer?: string } = {},
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const cfg = getSupabaseConfig();
  if (!cfg) {
    return { ok: false, status: 0, body: { error: "SUPABASE_NOT_CONFIGURED" } };
  }
  const headers: Record<string, string> = {
    apikey: cfg.key,
    Authorization: `Bearer ${cfg.key}`,
    "Content-Type": "application/json",
    ...(init.prefer ? { Prefer: init.prefer } : {}),
  };
  const res = await fetch(`${cfg.url}/rest/v1/${path}`, {
    ...init,
    headers: {
      ...headers,
      ...(init.headers as Record<string, string> | undefined),
    },
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

export async function supabaseRpc<T = unknown>(
  fn: string,
  args: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; body: T | unknown }> {
  return supabaseRest(`rpc/${fn}`, {
    method: "POST",
    body: JSON.stringify(args),
  }) as Promise<{ ok: boolean; status: number; body: T | unknown }>;
}
