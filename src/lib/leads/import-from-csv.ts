import { getDncScrubbers } from "@/lib/config";
import { parseCsv, guessFieldMapping } from "@/lib/csv";
import { scrubWithAll } from "@/lib/dnc/scrub";
import { toE164 } from "@/lib/phone";
import { getCampaign, importLeads, listLeads } from "@/lib/store/db";
import { eagerScheduleCampaign } from "@/lib/store/scheduled";

export const ALLOWED_CSV_HOST_SUFFIXES = [
  ".supabase.co",
  ".storage.supabase.co",
] as const;

export type CsvColumnMapping = {
  phone: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  company?: string;
};

export type ImportLeadsFromCsvResult = {
  campaignId: string;
  mode: "append" | "replace";
  imported: number;
  duplicates: number;
  replaced: number;
  skipped: number;
  dncHits: number;
  scheduled?: { created: number; existing: number };
  sourceUrlHost: string;
  mappingUsed: CsvColumnMapping;
};

function assertAllowedCsvUrl(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("url must be a valid absolute URL");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("url must use https");
  }
  const host = parsed.hostname.toLowerCase();
  const allowed = ALLOWED_CSV_HOST_SUFFIXES.some(
    (suffix) => host === suffix.slice(1) || host.endsWith(suffix),
  );
  if (!allowed) {
    throw new Error(
      `url host must be a Supabase HTTPS CSV URL (allowed: ${ALLOWED_CSV_HOST_SUFFIXES.join(", ")})`,
    );
  }
  return parsed;
}

function rowToLead(
  row: Record<string, string>,
  mapping: CsvColumnMapping,
) {
  const phone = row[mapping.phone] ?? "";
  const reserved = new Set(
    [
      mapping.phone,
      mapping.firstName,
      mapping.lastName,
      mapping.company,
      mapping.email,
    ].filter(Boolean) as string[],
  );
  const custom: Record<string, string> = {};
  for (const [k, v] of Object.entries(row)) {
    if (!reserved.has(k) && v) {
      const key = k
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_|_$/g, "");
      if (key) custom[key] = v;
    }
  }
  return {
    phone,
    firstName: mapping.firstName ? row[mapping.firstName] : undefined,
    lastName: mapping.lastName ? row[mapping.lastName] : undefined,
    company: mapping.company ? row[mapping.company] : undefined,
    email: mapping.email ? row[mapping.email] : undefined,
    custom,
  };
}

function resolveMapping(
  headers: string[],
  mapping?: Partial<CsvColumnMapping>,
): CsvColumnMapping {
  if (mapping?.phone) {
    return {
      phone: mapping.phone,
      firstName: mapping.firstName,
      lastName: mapping.lastName,
      company: mapping.company,
      email: mapping.email,
    };
  }
  // guessFieldMapping: header → role ("phone" | "first_name" | ...)
  const guessed = guessFieldMapping(headers);
  const byRole: Record<string, string> = {};
  for (const [header, role] of Object.entries(guessed)) {
    if (role === "phone") byRole.phone = header;
    else if (role === "first_name") byRole.firstName = header;
    else if (role === "last_name") byRole.lastName = header;
    else if (role === "company") byRole.company = header;
    else if (role === "email") byRole.email = header;
  }
  if (!byRole.phone) {
    throw new Error(
      "Could not detect a phone column. Pass mapping.phone with the CSV header name.",
    );
  }
  return {
    phone: byRole.phone,
    firstName: mapping?.firstName ?? byRole.firstName,
    lastName: mapping?.lastName ?? byRole.lastName,
    company: mapping?.company ?? byRole.company,
    email: mapping?.email ?? byRole.email,
  };
}

export async function importLeadsFromSignedCsvUrl(input: {
  campaignId: string;
  url: string;
  mapping?: Partial<CsvColumnMapping>;
  mode?: "append" | "replace";
}): Promise<ImportLeadsFromCsvResult> {
  const campaign = await getCampaign(input.campaignId);
  if (!campaign) {
    throw new Error(`Campaign not found: ${input.campaignId}`);
  }

  const parsedUrl = assertAllowedCsvUrl(input.url);
  const response = await fetch(input.url, {
    method: "GET",
    redirect: "follow",
    headers: { Accept: "text/csv,text/plain,*/*" },
  });
  if (!response.ok) {
    throw new Error(
      `Failed to download CSV from signed URL (HTTP ${response.status})`,
    );
  }

  const text = await response.text();
  if (!text.trim()) {
    throw new Error("Downloaded CSV is empty");
  }

  const { headers, rows } = parseCsv(text);
  if (!headers.length || rows.length === 0) {
    throw new Error("No data rows found in downloaded CSV");
  }

  const mappingUsed = resolveMapping(headers, input.mapping);
  const incoming = rows.map((cells) => {
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = cells[i] ?? "";
    });
    return rowToLead(row, mappingUsed);
  });

  const phones = incoming.map((l) => l.phone);
  const scrubbed = await scrubWithAll(getDncScrubbers(), phones);
  const byPhone = new Map(scrubbed.map((r) => [r.phoneE164, r]));

  const normalized = [];
  let skipped = 0;
  let dncHits = 0;

  for (const l of incoming) {
    const phoneE164 = toE164(l.phone);
    if (!phoneE164) {
      skipped += 1;
      continue;
    }
    const hit = byPhone.get(phoneE164);
    const dnc = Boolean(hit?.blocked);
    if (dnc) dncHits += 1;
    normalized.push({
      phoneE164,
      firstName: l.firstName,
      lastName: l.lastName,
      company: l.company,
      email: l.email,
      custom: l.custom ?? {},
      dnc,
      consentStatus: "UNKNOWN" as const,
    });
  }

  if (normalized.length === 0) {
    throw new Error("No lead rows with a valid phone found in downloaded CSV");
  }

  const mode = input.mode ?? "append";
  const result = await importLeads(input.campaignId, normalized, { mode });

  let scheduled: { created: number; existing: number } | undefined;
  if (campaign.status === "ACTIVE") {
    const leads = await listLeads(input.campaignId);
    scheduled = await eagerScheduleCampaign({ campaign, leads });
  }

  return {
    campaignId: input.campaignId,
    mode,
    imported: result.imported,
    duplicates: result.duplicates,
    replaced: result.replaced,
    skipped,
    dncHits,
    scheduled,
    sourceUrlHost: parsedUrl.hostname,
    mappingUsed,
  };
}
