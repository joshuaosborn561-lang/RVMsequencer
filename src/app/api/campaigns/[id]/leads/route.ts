import { NextResponse } from "next/server";
import { z } from "zod";
import { getDncScrubbers } from "@/lib/config";
import { parseCsv } from "@/lib/csv";
import { scrubWithAll } from "@/lib/dnc/scrub";
import { toE164 } from "@/lib/phone";
import { guardApiRateLimit } from "@/lib/security/api-guard";
import { getCampaign, importLeads, listLeads } from "@/lib/store/db";
import { eagerScheduleCampaign } from "@/lib/store/scheduled";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const leads = await listLeads(id);
  return NextResponse.json({ leads });
}

const LeadIn = z.object({
  phone: z.string(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  company: z.string().optional(),
  email: z.string().optional(),
  custom: z.record(z.string(), z.string()).optional(),
});

const Mapping = z.object({
  phone: z.string().min(1),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  company: z.string().optional(),
  email: z.string().optional(),
});

const Body = z.union([
  z.object({
    leads: z.array(LeadIn).min(1).max(5000),
    mode: z.enum(["append", "replace"]).optional(),
  }),
  z.object({
    csv: z.string().min(1),
    mapping: Mapping,
    mode: z.enum(["append", "replace"]).optional(),
  }),
]);

function rowToLead(
  row: Record<string, string>,
  mapping: z.infer<typeof Mapping>,
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

export async function POST(req: Request, ctx: Ctx) {
  const limited = await guardApiRateLimit(req, "leads");
  if (limited) return limited;
  const { id } = await ctx.params;
  const campaign = await getCampaign(id);
  if (!campaign) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const json: unknown = await req.json();
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const mode = parsed.data.mode ?? "append";
  let incoming: z.infer<typeof LeadIn>[];
  if ("csv" in parsed.data) {
    const { csv, mapping } = parsed.data;
    const { headers, rows } = parseCsv(csv);
    if (!headers.length) {
      return NextResponse.json({ error: "empty_csv" }, { status: 400 });
    }
    incoming = rows.map((cells) => {
      const row: Record<string, string> = {};
      headers.forEach((h, i) => {
        row[h] = cells[i] ?? "";
      });
      return rowToLead(row, mapping);
    });
  } else {
    incoming = parsed.data.leads;
  }

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

  const result = await importLeads(id, normalized, { mode });
  let scheduled: { created: number; existing: number } | undefined;
  if (campaign.status === "ACTIVE") {
    const leads = await listLeads(id);
    scheduled = await eagerScheduleCampaign({ campaign, leads });
  }
  return NextResponse.json({
    imported: result.imported,
    duplicates: result.duplicates,
    replaced: result.replaced,
    skipped,
    dncHits,
    mode,
    scheduled,
  });
}
