import { toE164 } from "@/lib/phone";
import { appendAudit, ensureLine, listLines } from "@/lib/store/db";
import type { LineRecord } from "@/lib/store/types";
import { configureTwilioNumberWebhooks } from "@/lib/twilio/configure-number";
import { twilioCredentials } from "@/lib/twilio/credentials";

export type FetchLike = typeof fetch;

export type TwilioNumberCapabilities = {
  voice: boolean;
  sms: boolean;
  mms: boolean;
};

export type TwilioNumberQuote = {
  country: string;
  numberType: "local";
  monthlyUsd: number;
  currency: string;
  interval: "month";
  label: string;
  note: string;
};

export type TwilioAvailableNumber = {
  e164: string;
  friendlyName?: string;
  locality?: string;
  region?: string;
  postalCode?: string;
  isoCountry?: string;
  capabilities: TwilioNumberCapabilities;
  quote?: TwilioNumberQuote;
};

export type TwilioOwnedNumber = TwilioAvailableNumber & { sid: string };

type TwilioAvailableRaw = {
  available_phone_numbers?: Array<{
    phone_number?: string;
    friendly_name?: string;
    locality?: string;
    region?: string;
    postal_code?: string;
    iso_country?: string;
    capabilities?: { voice?: boolean; SMS?: boolean; MMS?: boolean };
  }>;
  message?: string;
};

type TwilioIncomingRaw = {
  incoming_phone_numbers?: Array<{
    sid?: string;
    phone_number?: string;
    friendly_name?: string;
    capabilities?: { voice?: boolean; sms?: boolean; mms?: boolean };
  }>;
  message?: string;
};

const ALLOWED_COUNTRIES = new Set(["US", "CA"]);
const quoteCache = new Map<string, { quote: TwilioNumberQuote; exp: number }>();
const QUOTE_TTL_MS = 15 * 60 * 1000;

export function formatTwilioQuoteLabel(
  monthlyUsd: number,
  currency = "USD",
): string {
  return `$${monthlyUsd.toFixed(2)}/month (${currency})`;
}

export function mapTwilioPhoneNumberPrices(raw: {
  iso_country?: string;
  price_unit?: string;
  phone_number_prices?: Array<{
    number_type?: string;
    current_price?: string | number;
    base_price?: string | number;
  }>;
}): TwilioNumberQuote | null {
  const row = (raw.phone_number_prices ?? []).find(
    (p) => (p.number_type ?? "").toLowerCase().replace(/[_-]/g, " ") === "local",
  );
  const monthly = Number(row?.current_price ?? row?.base_price);
  if (!Number.isFinite(monthly) || monthly < 0) return null;
  const currency = (raw.price_unit ?? "USD").toUpperCase();
  const country = (raw.iso_country ?? "US").toUpperCase();
  return {
    country,
    numberType: "local",
    monthlyUsd: monthly,
    currency,
    interval: "month",
    label: formatTwilioQuoteLabel(monthly, currency),
    note: "Monthly number rent. Voice and SMS usage is billed separately.",
  };
}

export async function quoteTwilioLocalNumber(
  country = "US",
  fetchImpl: FetchLike = fetch,
): Promise<
  | { ok: true; quote: TwilioNumberQuote }
  | { ok: false; error: string; hint?: string }
> {
  const iso = normalizeTwilioCountry(country);
  if (!iso) return { ok: false, error: "unsupported_country" };
  const creds = twilioCredentials();
  if (!creds.ok) {
    return {
      ok: false,
      error: creds.error,
      hint: "Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN",
    };
  }
  const cached = quoteCache.get(iso);
  if (cached && cached.exp > Date.now()) return { ok: true, quote: cached.quote };

  const res = await fetchImpl(
    `https://pricing.twilio.com/v1/PhoneNumbers/Countries/${iso}`,
    { headers: { Authorization: creds.authHeader } },
  );
  const json = (await res.json()) as Parameters<typeof mapTwilioPhoneNumberPrices>[0] & {
    message?: string;
  };
  if (!res.ok) {
    return { ok: false, error: json.message || `HTTP_${res.status}` };
  }
  const quote = mapTwilioPhoneNumberPrices(json);
  if (!quote) return { ok: false, error: "price_unavailable" };
  quoteCache.set(iso, { quote, exp: Date.now() + QUOTE_TTL_MS });
  return { ok: true, quote };
}

export function normalizeTwilioCountry(raw?: string): string | null {
  const country = (raw ?? "US").trim().toUpperCase();
  if (!ALLOWED_COUNTRIES.has(country)) return null;
  return country;
}

function capabilitiesFromRaw(raw?: {
  voice?: boolean;
  SMS?: boolean;
  sms?: boolean;
  MMS?: boolean;
  mms?: boolean;
}): TwilioNumberCapabilities {
  return {
    voice: Boolean(raw?.voice),
    sms: Boolean(raw?.SMS ?? raw?.sms),
    mms: Boolean(raw?.MMS ?? raw?.mms),
  };
}

export function mapAvailableTwilioNumbers(
  raw: TwilioAvailableRaw,
): TwilioAvailableNumber[] {
  const out: TwilioAvailableNumber[] = [];
  for (const row of raw.available_phone_numbers ?? []) {
    const e164 = row.phone_number ? toE164(row.phone_number) : null;
    if (!e164) continue;
    out.push({
      e164,
      friendlyName: row.friendly_name,
      locality: row.locality,
      region: row.region,
      postalCode: row.postal_code,
      isoCountry: row.iso_country,
      capabilities: capabilitiesFromRaw(row.capabilities),
    });
  }
  return out;
}

export async function searchAvailableTwilioNumbers(
  input: {
    country?: string;
    areaCode?: string;
    contains?: string;
    locality?: string;
    region?: string;
    limit?: number;
  },
  fetchImpl: FetchLike = fetch,
): Promise<
  | { ok: true; numbers: TwilioAvailableNumber[]; quote?: TwilioNumberQuote }
  | { ok: false; error: string; hint?: string }
> {
  const creds = twilioCredentials();
  if (!creds.ok) {
    return {
      ok: false,
      error: creds.error,
      hint: "Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN",
    };
  }
  const country = normalizeTwilioCountry(input.country);
  if (!country) return { ok: false, error: "unsupported_country" };

  const qs = new URLSearchParams({
    VoiceEnabled: "true",
    SmsEnabled: "true",
    PageSize: String(Math.min(20, Math.max(1, input.limit ?? 10))),
  });
  const areaCode = input.areaCode?.replace(/\D/g, "") ?? "";
  if (areaCode) {
    if (areaCode.length !== 3) return { ok: false, error: "invalid_area_code" };
    qs.set("AreaCode", areaCode);
  }
  if (input.contains?.trim()) qs.set("Contains", input.contains.trim());
  if (input.locality?.trim()) qs.set("InLocality", input.locality.trim());
  if (input.region?.trim()) qs.set("InRegion", input.region.trim());

  const [res, priced] = await Promise.all([
    fetchImpl(
      `https://api.twilio.com/2010-04-01/Accounts/${creds.accountSid}/AvailablePhoneNumbers/${country}/Local.json?${qs}`,
      { headers: { Authorization: creds.authHeader } },
    ),
    quoteTwilioLocalNumber(country, fetchImpl),
  ]);
  const json = (await res.json()) as TwilioAvailableRaw;
  if (!res.ok) {
    return { ok: false, error: json.message || `HTTP_${res.status}` };
  }
  const quote = priced.ok ? priced.quote : undefined;
  const numbers = mapAvailableTwilioNumbers(json).map((n) =>
    quote ? { ...n, quote } : n,
  );
  return { ok: true, numbers, quote };
}

export async function listOwnedTwilioNumbers(
  input: { areaCode?: string; limit?: number } = {},
  fetchImpl: FetchLike = fetch,
): Promise<
  | { ok: true; numbers: TwilioOwnedNumber[] }
  | { ok: false; error: string; hint?: string }
> {
  const creds = twilioCredentials();
  if (!creds.ok) {
    return {
      ok: false,
      error: creds.error,
      hint: "Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN",
    };
  }
  const qs = new URLSearchParams({
    PageSize: String(Math.min(100, Math.max(1, input.limit ?? 50))),
  });
  const res = await fetchImpl(
    `https://api.twilio.com/2010-04-01/Accounts/${creds.accountSid}/IncomingPhoneNumbers.json?${qs}`,
    { headers: { Authorization: creds.authHeader } },
  );
  const json = (await res.json()) as TwilioIncomingRaw;
  if (!res.ok) {
    return { ok: false, error: json.message || `HTTP_${res.status}` };
  }
  const areaCode = input.areaCode?.replace(/\D/g, "") ?? "";
  const numbers: TwilioOwnedNumber[] = [];
  for (const row of json.incoming_phone_numbers ?? []) {
    const e164 = row.phone_number ? toE164(row.phone_number) : null;
    if (!e164 || !row.sid) continue;
    if (areaCode && !e164.includes(areaCode)) continue;
    numbers.push({
      sid: row.sid,
      e164,
      friendlyName: row.friendly_name,
      isoCountry: e164.startsWith("+1") ? "US" : undefined,
      capabilities: capabilitiesFromRaw(row.capabilities),
    });
  }
  return { ok: true, numbers };
}

export type ProvisionTwilioNumberResult =
  | {
      ok: true;
      line: LineRecord;
      purchased: boolean;
      imported: boolean;
      twilioSid?: string;
      webhooks?: Awaited<ReturnType<typeof configureTwilioNumberWebhooks>>;
    }
  | { ok: false; error: string; hint?: string };

async function findOwnedSid(
  e164: string,
  fetchImpl: FetchLike,
): Promise<{ sid?: string; error?: string }> {
  const creds = twilioCredentials();
  if (!creds.ok) return { error: creds.error };
  const qs = new URLSearchParams({ PhoneNumber: e164 });
  const res = await fetchImpl(
    `https://api.twilio.com/2010-04-01/Accounts/${creds.accountSid}/IncomingPhoneNumbers.json?${qs}`,
    { headers: { Authorization: creds.authHeader } },
  );
  const json = (await res.json()) as TwilioIncomingRaw;
  if (!res.ok) return { error: json.message || `HTTP_${res.status}` };
  return { sid: json.incoming_phone_numbers?.[0]?.sid };
}

async function buyNumber(
  e164: string,
  fetchImpl: FetchLike,
): Promise<{ sid?: string; error?: string }> {
  const creds = twilioCredentials();
  if (!creds.ok) return { error: creds.error };
  const res = await fetchImpl(
    `https://api.twilio.com/2010-04-01/Accounts/${creds.accountSid}/IncomingPhoneNumbers.json`,
    {
      method: "POST",
      headers: {
        Authorization: creds.authHeader,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ PhoneNumber: e164 }),
    },
  );
  const json = (await res.json()) as { sid?: string; message?: string };
  if (!res.ok) return { error: json.message || `HTTP_${res.status}` };
  return { sid: json.sid };
}

/**
 * Add a DID to the local pool. Buys it on Twilio when it is not already owned.
 * Does not rewrite existing pool rows. Webhooks are optional (default on).
 */
export async function provisionTwilioNumber(
  input: {
    e164?: string;
    areaCode?: string;
    country?: string;
    configureVoice?: boolean;
  },
  fetchImpl: FetchLike = fetch,
): Promise<ProvisionTwilioNumberResult> {
  const creds = twilioCredentials();
  if (!creds.ok) {
    return {
      ok: false,
      error: creds.error,
      hint: "Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN",
    };
  }

  let e164 = input.e164 ? toE164(input.e164) : null;
  if (!e164 && input.areaCode) {
    const search = await searchAvailableTwilioNumbers(
      {
        country: input.country,
        areaCode: input.areaCode,
        limit: 1,
      },
      fetchImpl,
    );
    if (!search.ok) return search;
    e164 = search.numbers[0]?.e164 ?? null;
    if (!e164) return { ok: false, error: "no_available_numbers" };
  }
  if (!e164) {
    return {
      ok: false,
      error: "e164_or_area_code_required",
      hint: "Pass e164 from lines_search, or an areaCode to buy the first match",
    };
  }

  const existing = (await listLines()).find((l) => l.e164 === e164);
  if (existing) {
    let webhooks: Awaited<ReturnType<typeof configureTwilioNumberWebhooks>> | undefined;
    if (input.configureVoice !== false) {
      webhooks = await configureTwilioNumberWebhooks({ e164 });
    }
    return {
      ok: true,
      line: existing,
      purchased: false,
      imported: false,
      webhooks,
    };
  }

  const owned = await findOwnedSid(e164, fetchImpl);
  if (owned.error && owned.error !== "TWILIO_NOT_CONFIGURED") {
    return { ok: false, error: owned.error };
  }

  let purchased = false;
  let twilioSid = owned.sid;
  if (!twilioSid) {
    const bought = await buyNumber(e164, fetchImpl);
    if (bought.error) return { ok: false, error: bought.error };
    twilioSid = bought.sid;
    purchased = true;
  }

  const line = await ensureLine(e164);
  let webhooks: Awaited<ReturnType<typeof configureTwilioNumberWebhooks>> | undefined;
  if (input.configureVoice !== false) {
    webhooks = await configureTwilioNumberWebhooks({
      e164,
      phoneNumberSid: twilioSid,
    });
  }

  await appendAudit({
    action: "LINE_PROVISIONED",
    actor: "api",
    entityType: "line",
    entityId: line.id,
    detail: { e164, purchased, imported: !purchased, twilioSid },
  });

  return {
    ok: true,
    line,
    purchased,
    imported: !purchased,
    twilioSid,
    webhooks,
  };
}
