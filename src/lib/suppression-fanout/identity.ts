import { toE164 } from "@/lib/phone";
import { isSupabaseConfigured, supabaseRest } from "@/lib/supabase/config";
import type { LeadRecord } from "@/lib/store/types";
import type { ResolvedIdentity, SuppressionEvent } from "./types";

const CONSUMER_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "ymail.com",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "msn.com",
  "aol.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "proton.me",
  "protonmail.com",
  "comcast.net",
  "att.net",
  "sbcglobal.net",
  "verizon.net",
  "bellsouth.net",
]);

export function normalizeEmail(raw: string | null | undefined): string | undefined {
  const v = raw?.trim().toLowerCase();
  if (!v || !v.includes("@")) return undefined;
  return v;
}

export function domainFromEmail(email: string | null | undefined): string | undefined {
  const e = normalizeEmail(email);
  if (!e) return undefined;
  const host = e.split("@")[1]?.replace(/^www\./, "");
  if (!host || CONSUMER_DOMAINS.has(host)) return undefined;
  return host;
}

export function domainFromWebsite(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    const url = raw.includes("://") ? new URL(raw) : new URL(`https://${raw}`);
    const host = url.hostname.replace(/^www\./i, "").toLowerCase();
    if (!host || CONSUMER_DOMAINS.has(host)) return undefined;
    return host;
  } catch {
    const host = raw
      .replace(/^https?:\/\//i, "")
      .replace(/^www\./i, "")
      .split("/")[0]
      ?.toLowerCase();
    if (!host || !host.includes(".") || CONSUMER_DOMAINS.has(host)) return undefined;
    return host;
  }
}

export function mergeIdentity(
  ...parts: Array<Partial<ResolvedIdentity> | undefined>
): ResolvedIdentity {
  const out: ResolvedIdentity = {};
  for (const p of parts) {
    if (!p) continue;
    out.phoneE164 = out.phoneE164 ?? p.phoneE164;
    out.email = out.email ?? p.email;
    out.domain = out.domain ?? p.domain;
    out.firstName = out.firstName ?? p.firstName;
    out.lastName = out.lastName ?? p.lastName;
    out.company = out.company ?? p.company;
  }
  if (!out.domain && out.email) out.domain = domainFromEmail(out.email);
  return out;
}

export function identityFromEvent(event: SuppressionEvent): ResolvedIdentity {
  return mergeIdentity({
    phoneE164: event.phoneE164,
    email: normalizeEmail(event.email),
    domain: event.domain ?? domainFromEmail(event.email),
    firstName: event.firstName,
    lastName: event.lastName,
    company: event.company,
  });
}

export function identityFromLead(lead: LeadRecord): ResolvedIdentity {
  return {
    phoneE164: lead.phoneE164,
    email: normalizeEmail(lead.email),
    domain: domainFromEmail(lead.email),
    firstName: lead.firstName,
    lastName: lead.lastName,
    company: lead.company,
  };
}

function tenDigits(phone: string | undefined): string | null {
  if (!phone) return null;
  return phone.replace(/\D/g, "").match(/(\d{10})$/)?.[1] ?? null;
}

export async function identityFromLocalLeads(
  phoneE164: string | undefined,
  listLeads: () => Promise<LeadRecord[]>,
): Promise<ResolvedIdentity | undefined> {
  const ten = tenDigits(phoneE164);
  if (!ten) return undefined;
  const leads = await listLeads();
  const match = leads.find((l) => tenDigits(l.phoneE164) === ten);
  return match ? identityFromLead(match) : undefined;
}

type MapsRow = {
  email?: string | null;
  domain?: string | null;
  website?: string | null;
  phone?: string | null;
  owner_name?: string | null;
  name?: string | null;
};

function splitName(raw: string | null | undefined): { firstName?: string; lastName?: string } {
  const t = raw?.trim();
  if (!t) return {};
  const parts = t.split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0] };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

export async function identityFromMapsLeads(
  phoneE164: string | undefined,
): Promise<ResolvedIdentity | undefined> {
  if (!isSupabaseConfigured()) return undefined;
  const ten = tenDigits(phoneE164);
  const e164 = phoneE164 ? toE164(phoneE164) : null;
  if (!ten) return undefined;

  const or = [
    e164 ? `phone.eq.${encodeURIComponent(e164)}` : "",
    `phone.eq.${ten}`,
    `phone.eq.${encodeURIComponent(`+1${ten}`)}`,
    `phone.like.*${ten}*`,
  ]
    .filter(Boolean)
    .join(",");

  const res = await supabaseRest(
    `maps_leads?select=email,domain,website,phone,owner_name,name&or=(${or})&limit=5`,
    { method: "GET" },
  );
  if (!res.ok || !Array.isArray(res.body)) return undefined;
  const row = (res.body as MapsRow[])[0];
  if (!row) return undefined;
  const names = splitName(row.owner_name);
  return {
    phoneE164: e164 ?? phoneE164,
    email: normalizeEmail(row.email ?? undefined),
    domain:
      domainFromWebsite(row.domain) ??
      domainFromWebsite(row.website) ??
      domainFromEmail(row.email),
    firstName: names.firstName,
    lastName: names.lastName,
    company: row.name ?? undefined,
  };
}

export type IdentityLookup = {
  listLeads: () => Promise<LeadRecord[]>;
  lookupMaps?: (phoneE164: string | undefined) => Promise<ResolvedIdentity | undefined>;
};

export async function resolveIdentity(
  event: SuppressionEvent,
  lookup: IdentityLookup,
): Promise<ResolvedIdentity> {
  const fromEvent = identityFromEvent(event);
  const fromLocal = await identityFromLocalLeads(fromEvent.phoneE164, lookup.listLeads);
  const mapsFn = lookup.lookupMaps ?? identityFromMapsLeads;
  const fromMaps = fromEvent.phoneE164
    ? await mapsFn(fromEvent.phoneE164).catch(() => undefined)
    : undefined;
  return mergeIdentity(fromEvent, fromLocal, fromMaps);
}

export function hasAnyIdentity(id: ResolvedIdentity): boolean {
  return Boolean(id.phoneE164 || id.email || id.domain);
}
