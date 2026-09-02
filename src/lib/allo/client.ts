/**
 * Allo REST client (api.withallo.com).
 * Auth: Authorization: Api-Key …
 */

const BASE = "https://api.withallo.com";

export type AlloPhoneNumber = {
  number: string | null;
  name?: string;
  type?: string;
  country?: string;
};

export type AlloTranscriptEntry = {
  source?: "USER" | "EXTERNAL" | string;
  time?: string;
  text?: string;
};

export type AlloConversationItem = {
  id: string;
  type?: "CALL" | "SMS" | string;
  direction?: "INBOUND" | "OUTBOUND" | string;
  allo_number?: string;
  contact_number?: string;
  /** Present on some Allo payloads; prefer contact_number when set. */
  from_number?: string;
  to_number?: string;
  date?: string;
  duration?: number | null;
  result?: "ANSWERED" | "VOICEMAIL" | "TRANSFERRED" | string | null;
  summary?: string | null;
  tags?: string[] | null;
  transcript?: AlloTranscriptEntry[] | { transcripts?: AlloTranscriptEntry[] } | null;
  user?: { id?: string; name?: string } | null;
};

export type AlloSearchParams = {
  allo_number?: string;
  type?: "CALL" | "SMS" | "ALL";
  direction?: "INBOUND" | "OUTBOUND";
  result?: "ANSWERED" | "VOICEMAIL" | "TRANSFERRED";
  tags?: string[];
  date?: { from: string; to: string };
  page?: number;
  size?: number;
  extend?: string;
  search?: string;
  sort?: "DATE_DESC" | "DATE_ASC" | "RELEVANCE";
};

function requireApiKey(): string {
  const key = process.env.ALLO_API_KEY?.trim();
  if (!key) {
    throw new Error("ALLO_API_KEY is required for Allo suppression sync");
  }
  return key;
}

/** Mask phone for logs — last four only. */
export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return "****";
  const d = phone.replace(/\D/g, "");
  if (d.length < 4) return "****";
  return `***${d.slice(-4)}`;
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

async function alloFetch<T>(
  path: string,
  init?: RequestInit & { retries?: number },
): Promise<T> {
  const key = requireApiKey();
  const retries = init?.retries ?? 5;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Api-Key ${key}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
    if (res.status === 429 || res.status >= 500) {
      const retryAfter = Number(res.headers.get("retry-after") || 0);
      const wait = retryAfter > 0 ? retryAfter * 1000 : Math.min(30_000, 500 * 2 ** attempt);
      await sleep(wait);
      lastErr = new Error(`Allo HTTP ${res.status}`);
      continue;
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Allo HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    return (await res.json()) as T;
  }
  throw lastErr instanceof Error ? lastErr : new Error("Allo request failed");
}

export async function listAlloNumbers(): Promise<AlloPhoneNumber[]> {
  const json = await alloFetch<{ data?: AlloPhoneNumber[] }>("/v2/api/numbers");
  return (json.data ?? []).filter((n) => n.number && n.type !== "SENDER_ID");
}

export async function searchConversationItems(
  body: AlloSearchParams,
): Promise<{
  items: AlloConversationItem[];
  pagination: {
    page: number;
    size: number;
    total_count: number;
    has_more: boolean;
  };
}> {
  const json = await alloFetch<{
    data?: AlloConversationItem[];
    pagination?: {
      page?: number;
      size?: number;
      total_count?: number;
      has_more?: boolean;
    };
  }>("/v2/api/conversations/items/search", {
    method: "POST",
    body: JSON.stringify(body),
  });
  const p = json.pagination ?? {};
  const page = p.page ?? body.page ?? 1;
  const size = p.size ?? body.size ?? 20;
  const total = p.total_count ?? (json.data?.length ?? 0);
  const items = json.data ?? [];
  const hasMore =
    typeof p.has_more === "boolean"
      ? p.has_more
      : page * size < total && items.length > 0;
  return {
    items,
    pagination: {
      page,
      size,
      total_count: total,
      has_more: hasMore,
    },
  };
}

/** Fetch one item with transcript extend. */
export async function getConversationItemWithTranscript(
  id: string,
): Promise<AlloConversationItem> {
  const json = await alloFetch<{ data?: AlloConversationItem }>(
    `/v2/api/conversations/items/${encodeURIComponent(id)}?extend=transcript`,
  );
  if (!json.data) throw new Error(`Allo item missing: ${id}`);
  const item = json.data;
  // Normalize nested Allo transcript shape → flat array
  const t = item.transcript as
    | AlloTranscriptEntry[]
    | { transcripts?: AlloTranscriptEntry[] }
    | null
    | undefined;
  if (t && !Array.isArray(t) && Array.isArray(t.transcripts)) {
    item.transcript = t.transcripts;
  }
  return item;
}

/** Page through all CALL items for a line in a date window. */
export async function* iterateCallsForLine(input: {
  alloNumber: string;
  dateFrom: string; // YYYY-MM-DD
  dateTo: string;
  direction?: "INBOUND" | "OUTBOUND";
}): AsyncGenerator<AlloConversationItem> {
  let page = 1;
  for (;;) {
    const { items, pagination } = await searchConversationItems({
      allo_number: input.alloNumber,
      type: "CALL",
      direction: input.direction,
      date: { from: input.dateFrom, to: input.dateTo },
      page,
      size: 100,
      sort: "DATE_ASC",
    });
    for (const item of items) {
      if (item.type === "SMS") continue;
      yield item;
    }
    if (!pagination.has_more || items.length === 0) break;
    page += 1;
    // gentle pacing under rate limits
    await sleep(50);
  }
}

export function isAlloSyncConfigured(): boolean {
  return Boolean(process.env.ALLO_API_KEY?.trim());
}

export function isAlloSyncEnabled(): boolean {
  const flag = process.env.ALLO_SUPPRESSION_SYNC?.trim().toLowerCase();
  if (flag === "0" || flag === "false" || flag === "off") return false;
  if (flag === "1" || flag === "true" || flag === "on") return true;
  // Enabled implicitly when API key is present
  return isAlloSyncConfigured();
}

export function assertAlloSyncReady(): void {
  if (!isAlloSyncEnabled()) return;
  if (!isAlloSyncConfigured()) {
    throw new Error(
      "ALLO_SUPPRESSION_SYNC is enabled but ALLO_API_KEY is missing",
    );
  }
}
