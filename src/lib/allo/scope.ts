import { listCampaigns, listLeads } from "@/lib/store/db";
import { suppressionScope } from "@/lib/allo/sync-state";

/** 10-digit set of every lead phone across campaigns (salesglider scope). */
export async function readAllLeadPhones(): Promise<Set<string>> {
  const campaigns = await listCampaigns();
  const out = new Set<string>();
  for (const c of campaigns) {
    const leads = await listLeads(c.id);
    for (const l of leads) {
      const digits = String(l.phoneE164 || "").replace(/\D/g, "");
      const m = digits.match(/(\d{10})$/);
      if (m) out.add(m[1]!);
    }
  }
  return out;
}

/** global = all Allo contacts; salesglider = only phones already in lead pool. */
export async function phoneInScope(phoneE164: string): Promise<boolean> {
  if (suppressionScope() === "global") return true;
  const ten = phoneE164.replace(/\D/g, "").match(/(\d{10})$/)?.[1];
  if (!ten) return false;
  const leadPhones = await readAllLeadPhones();
  return leadPhones.has(ten);
}
