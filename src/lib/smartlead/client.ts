/**
 * Smartlead REST client. Emails never go to logs.
 */

const DEFAULT_BASE = "https://server.smartlead.ai/api/v1";

export function getSmartleadApiKey(): string | undefined {
  return (
    process.env.SMARTLEAD_API_KEY?.trim() ||
    process.env.SMARTLEAD_API_TOKEN?.trim() ||
    undefined
  );
}

export function isSmartleadConfigured(): boolean {
  return Boolean(getSmartleadApiKey());
}

function baseUrl(): string {
  return (process.env.SMARTLEAD_API_URL?.trim() || DEFAULT_BASE).replace(/\/$/, "");
}

async function slFetch<T>(
  method: string,
  path: string,
  opts?: { query?: Record<string, string | number | boolean>; body?: unknown },
): Promise<{ ok: boolean; status: number; body: T | unknown }> {
  const key = getSmartleadApiKey();
  if (!key) return { ok: false, status: 0, body: { error: "SMARTLEAD_NOT_CONFIGURED" } };
  const url = new URL(`${baseUrl()}${path.startsWith("/") ? path : `/${path}`}`);
  url.searchParams.set("api_key", key);
  for (const [k, v] of Object.entries(opts?.query ?? {})) {
    url.searchParams.set(k, String(v));
  }
  const res = await fetch(url.toString(), {
    method,
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: opts?.body != null ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* keep */
  }
  return { ok: res.ok, status: res.status, body };
}

export type SmartleadLead = {
  id?: number | string;
  lead_id?: number | string;
  email?: string;
  phone_number?: string;
  first_name?: string;
  last_name?: string;
  company_name?: string;
  is_unsubscribed?: boolean;
};

function leadId(row: SmartleadLead | null | undefined): string | number | undefined {
  if (!row) return undefined;
  return row.id ?? row.lead_id;
}

export async function getLeadByEmail(
  email: string,
): Promise<SmartleadLead | null> {
  const res = await slFetch<{ id?: number } | SmartleadLead>("GET", "/leads/", {
    query: { email },
  });
  if (!res.ok) return null;
  const body = res.body as SmartleadLead | { data?: SmartleadLead } | null;
  if (!body || typeof body !== "object") return null;
  if ("data" in body && body.data) return body.data;
  if (leadId(body as SmartleadLead) || (body as SmartleadLead).email) {
    return body as SmartleadLead;
  }
  return null;
}

export async function addToBlockList(input: {
  email?: string;
  domain?: string;
}): Promise<{ ok: boolean; status: number }> {
  const list = [input.email, input.domain].filter(Boolean) as string[];
  if (list.length === 0) return { ok: true, status: 200 };
  const asArray = await slFetch("POST", "/leads/add-domain-block-list", {
    body: { domain_block_list: list, client_id: null },
  });
  if (asArray.ok) return { ok: true, status: asArray.status };
  // Some workspaces accept { email } / { domain } instead of the array form.
  if (input.email) {
    const one = await slFetch("POST", "/leads/add-domain-block-list", {
      body: { email: input.email },
    });
    if (one.ok) return { ok: true, status: one.status };
  }
  if (input.domain) {
    const one = await slFetch("POST", "/leads/add-domain-block-list", {
      body: { domain: input.domain },
    });
    return { ok: one.ok, status: one.status };
  }
  return { ok: false, status: asArray.status };
}

export async function unsubscribeLeadGlobal(
  id: string | number,
): Promise<{ ok: boolean; status: number }> {
  const res = await slFetch("POST", `/leads/${id}/unsubscribe`);
  return { ok: res.ok || res.status === 404, status: res.status };
}

export async function pauseCampaignLead(
  campaignId: string | number,
  leadIdValue: string | number,
): Promise<{ ok: boolean; status: number }> {
  const res = await slFetch(
    "POST",
    `/campaigns/${campaignId}/leads/${leadIdValue}/pause`,
  );
  return { ok: res.ok || res.status === 404, status: res.status };
}

export async function unsubscribeCampaignLead(
  campaignId: string | number,
  leadIdValue: string | number,
): Promise<{ ok: boolean; status: number }> {
  const res = await slFetch(
    "POST",
    `/campaigns/${campaignId}/leads/${leadIdValue}/unsubscribe`,
  );
  return { ok: res.ok || res.status === 404, status: res.status };
}

export type SmartleadCampaign = { id?: number; campaign_id?: number; name?: string };

export async function listCampaigns(): Promise<SmartleadCampaign[]> {
  const res = await slFetch<SmartleadCampaign[] | { data?: SmartleadCampaign[] }>(
    "GET",
    "/campaigns",
  );
  if (!res.ok) return [];
  const body = res.body;
  if (Array.isArray(body)) return body;
  if (body && typeof body === "object" && Array.isArray((body as { data?: unknown }).data)) {
    return (body as { data: SmartleadCampaign[] }).data;
  }
  return [];
}

export async function getDomainBlockList(): Promise<string[]> {
  const res = await slFetch<unknown>("GET", "/leads/get-domain-block-list");
  if (!res.ok) return [];
  const body = res.body;
  if (Array.isArray(body)) {
    return body.map((x) => (typeof x === "string" ? x : String((x as { domain?: string }).domain ?? ""))).filter(Boolean);
  }
  if (body && typeof body === "object") {
    const rec = body as Record<string, unknown>;
    const list =
      rec.domain_block_list ??
      rec.data ??
      rec.domains ??
      rec.list;
    if (Array.isArray(list)) {
      return list
        .map((x) => (typeof x === "string" ? x : String((x as { domain?: string; email?: string }).domain ?? (x as { email?: string }).email ?? "")))
        .filter(Boolean);
    }
  }
  return [];
}

export async function findLeadCampaignIds(
  email: string,
): Promise<{ leadId: string | number; campaignIds: Array<string | number> }> {
  const lead = await getLeadByEmail(email);
  const id = leadId(lead);
  if (!id) return { leadId: "", campaignIds: [] };
  const extra = lead as SmartleadLead & {
    campaign_lead_map_id?: number;
    campaigns?: Array<{ campaign_id?: number; id?: number }>;
  };
  const campaignIds: Array<string | number> = [];
  if (Array.isArray(extra.campaigns)) {
    for (const c of extra.campaigns) {
      const cid = c.campaign_id ?? c.id;
      if (cid != null) campaignIds.push(cid);
    }
  }
  return { leadId: id, campaignIds };
}
