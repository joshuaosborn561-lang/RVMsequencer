import { NextResponse } from "next/server";
import { ingestSmartleadUnsub } from "@/lib/suppression-fanout/engine";
import { domainFromEmail, normalizeEmail } from "@/lib/suppression-fanout/identity";

/**
 * Smartlead LEAD_UNSUBSCRIBED (and similar) → queue for hourly fan-out.
 * Never logs the email.
 */
export async function POST(req: Request) {
  const secret = process.env.SMARTLEAD_WEBHOOK_SECRET?.trim();
  if (secret) {
    const header =
      req.headers.get("x-webhook-secret") ??
      req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
      "";
    if (header !== secret) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  let json: Record<string, unknown> = {};
  try {
    json = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const eventType = String(json.event_type ?? json.eventType ?? json.type ?? "");
  const isUnsub = /unsub/i.test(eventType) || json.unsubscribed === true;
  if (eventType && !isUnsub && !/not_interested|do_not_contact/i.test(eventType)) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const email = normalizeEmail(
    String(json.lead_email ?? json.email ?? json.to_email ?? ""),
  );
  const phone = String(json.phone_number ?? json.phone ?? json.lead_phone ?? "");
  const domain =
    String(json.domain ?? "") ||
    domainFromEmail(email);
  if (!email && !phone && !domain) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const campaignId = json.campaign_id ?? json.email_campaign_id;
  const leadId = json.lead_id ?? json.id;
  const id = [
    "unsub",
    String(leadId || email || domain || "unknown"),
    String(campaignId ?? ""),
  ].join(":");

  await ingestSmartleadUnsub({
    id,
    eventType: eventType || "LEAD_UNSUBSCRIBED",
    email,
    phone: phone || undefined,
    domain: domain || undefined,
    firstName: json.first_name != null ? String(json.first_name) : undefined,
    lastName: json.last_name != null ? String(json.last_name) : undefined,
    company: json.company_name != null ? String(json.company_name) : json.campaign_name != null ? undefined : undefined,
    campaignId: campaignId != null ? String(campaignId) : undefined,
    occurredAt: new Date().toISOString(),
  });

  return NextResponse.json({ ok: true });
}
