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

export type TwilioAvailableNumber = {
  e164: string;
  friendlyName?: string;
  locality?: string;
  region?: string;
  postalCode?: string;
  isoCountry?: string;
  capabilities: TwilioNumberCapabilities;
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
  | { ok: true; numbers: TwilioAvailableNumber[] }
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

  const res = await fetchImpl(
    `https://api.twilio.com/2010-04-01/Accounts/${creds.accountSid}/AvailablePhoneNumbers/${country}/Local.json?${qs}`,
    { headers: { Authorization: creds.authHeader } },
  );
  const json = (await res.json()) as TwilioAvailableRaw;
  if (!res.ok) {
    return { ok: false, error: json.message || `HTTP_${res.status}` };
  }
  return { ok: true, numbers: mapAvailableTwilioNumbers(json) };
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
