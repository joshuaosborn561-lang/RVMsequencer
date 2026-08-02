/**
 * Minimal HubSpot CRM client for RVM callback sync.
 * Auth: private app token → HUBSPOT_ACCESS_TOKEN
 * Scopes: crm.objects.contacts.write, crm.objects.contacts.read,
 *         crm.objects.contacts.sensitive.write (if needed),
 *         crm.objects.notes.write / crm.objects.calls.write
 */

const HS_BASE = "https://api.hubapi.com";

/** HubSpot-defined association: call → contact */
const ASSOC_CALL_TO_CONTACT = 194;
/** HubSpot-defined association: note → contact */
const ASSOC_NOTE_TO_CONTACT = 202;

export type HubSpotCallbackEvent = {
  phoneE164: string;
  didE164?: string;
  channel: "VOICE_CALLBACK" | "SMS" | "NOTE";
  body: string;
  campaignId?: string;
  campaignName?: string;
  clientId?: string;
  clientName?: string;
  providerEventId?: string;
  ownerId?: string;
  firstName?: string;
  lastName?: string;
  company?: string;
  email?: string;
};

export type HubSpotSyncResult =
  | {
      ok: true;
      contactId: string;
      engagementId?: string;
      engagementType: "call" | "note";
      createdContact: boolean;
    }
  | { ok: false; skipped?: boolean; error: string };

function token(): string | null {
  return process.env.HUBSPOT_ACCESS_TOKEN?.trim() || null;
}

export function hubspotConfigured(): boolean {
  return Boolean(token());
}

function phoneVariants(e164: string): string[] {
  const digits = e164.replace(/\D/g, "");
  const local10 =
    digits.length === 11 && digits.startsWith("1")
      ? digits.slice(1)
      : digits.length === 10
        ? digits
        : digits;
  const set = new Set<string>([e164, digits, local10, `+1${local10}`, `1${local10}`]);
  return [...set].filter(Boolean);
}

async function hsFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<{ ok: boolean; status: number; data: T | null; raw: string }> {
  const t = token();
  if (!t) {
    return { ok: false, status: 0, data: null, raw: "HUBSPOT_NOT_CONFIGURED" };
  }
  const res = await fetch(`${HS_BASE}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${t}`,
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const raw = await res.text();
  let data: T | null = null;
  try {
    data = raw ? (JSON.parse(raw) as T) : null;
  } catch {
    data = null;
  }
  return { ok: res.ok, status: res.status, data, raw };
}

async function searchContactId(phoneE164: string): Promise<string | null> {
  const variants = phoneVariants(phoneE164);
  for (const prop of ["phone", "mobilephone"] as const) {
    for (const value of variants) {
      const { ok, data } = await hsFetch<{
        results?: Array<{ id: string }>;
      }>("/crm/v3/objects/contacts/search", {
        method: "POST",
        body: JSON.stringify({
          filterGroups: [
            {
              filters: [
                { propertyName: prop, operator: "EQ", value },
              ],
            },
          ],
          properties: ["phone", "mobilephone", "firstname", "lastname"],
          limit: 1,
        }),
      });
      if (ok && data?.results?.[0]?.id) return data.results[0].id;
    }
  }
  return null;
}

async function createContact(event: HubSpotCallbackEvent): Promise<{
  id: string | null;
  error?: string;
}> {
  const props: Record<string, string> = {
    phone: event.phoneE164,
    mobilephone: event.phoneE164,
  };
  if (event.firstName) props.firstname = event.firstName;
  if (event.lastName) props.lastname = event.lastName;
  if (event.company) props.company = event.company;
  if (event.email) props.email = event.email;
  if (event.ownerId) props.hubspot_owner_id = event.ownerId;

  const { ok, data, raw, status } = await hsFetch<{ id: string }>(
    "/crm/v3/objects/contacts",
    { method: "POST", body: JSON.stringify({ properties: props }) },
  );
  if (!ok || !data?.id) {
    return { id: null, error: `create_contact_${status}: ${raw.slice(0, 200)}` };
  }
  return { id: data.id };
}

async function patchContact(
  id: string,
  event: HubSpotCallbackEvent,
): Promise<void> {
  const props: Record<string, string> = {
    phone: event.phoneE164,
  };
  if (event.firstName) props.firstname = event.firstName;
  if (event.lastName) props.lastname = event.lastName;
  if (event.company) props.company = event.company;
  if (event.ownerId) props.hubspot_owner_id = event.ownerId;
  await hsFetch(`/crm/v3/objects/contacts/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ properties: props }),
  });
}

function engagementBody(event: HubSpotCallbackEvent): string {
  const lines = [
    `<strong>RVM Drop callback</strong>`,
    `Phone: ${event.phoneE164}`,
    event.didE164 ? `Campaign DID: ${event.didE164}` : null,
    event.campaignName
      ? `Campaign: ${event.campaignName}${event.campaignId ? ` (${event.campaignId})` : ""}`
      : event.campaignId
        ? `Campaign: ${event.campaignId}`
        : null,
    event.clientName ? `Client: ${event.clientName}` : null,
    `Channel: ${event.channel}`,
    event.providerEventId ? `Provider event: ${event.providerEventId}` : null,
    "",
    event.body,
  ].filter((x) => x != null);
  return lines.join("<br/>");
}

async function createCallEngagement(
  contactId: string,
  event: HubSpotCallbackEvent,
): Promise<{ id?: string; error?: string }> {
  const props: Record<string, string> = {
    hs_timestamp: String(Date.now()),
    hs_call_title: `RVM callback — ${event.phoneE164}`,
    hs_call_body: engagementBody(event),
    hs_call_direction: "INBOUND",
    hs_call_status: "COMPLETED",
    hs_call_source: "INTEGRATIONS_PLATFORM",
  };
  if (event.ownerId) props.hubspot_owner_id = event.ownerId;

  const { ok, data, raw, status } = await hsFetch<{ id: string }>(
    "/crm/v3/objects/calls",
    {
      method: "POST",
      body: JSON.stringify({
        properties: props,
        associations: [
          {
            to: { id: contactId },
            types: [
              {
                associationCategory: "HUBSPOT_DEFINED",
                associationTypeId: ASSOC_CALL_TO_CONTACT,
              },
            ],
          },
        ],
      }),
    },
  );
  if (!ok || !data?.id) {
    return { error: `create_call_${status}: ${raw.slice(0, 200)}` };
  }
  return { id: data.id };
}

async function createNoteEngagement(
  contactId: string,
  event: HubSpotCallbackEvent,
): Promise<{ id?: string; error?: string }> {
  const props: Record<string, string> = {
    hs_timestamp: String(Date.now()),
    hs_note_body: engagementBody(event),
  };
  if (event.ownerId) props.hubspot_owner_id = event.ownerId;

  const { ok, data, raw, status } = await hsFetch<{ id: string }>(
    "/crm/v3/objects/notes",
    {
      method: "POST",
      body: JSON.stringify({
        properties: props,
        associations: [
          {
            to: { id: contactId },
            types: [
              {
                associationCategory: "HUBSPOT_DEFINED",
                associationTypeId: ASSOC_NOTE_TO_CONTACT,
              },
            ],
          },
        ],
      }),
    },
  );
  if (!ok || !data?.id) {
    return { error: `create_note_${status}: ${raw.slice(0, 200)}` };
  }
  return { id: data.id };
}

/**
 * Upsert HubSpot contact by phone and log a callback Call (or Note fallback).
 */
export async function syncCallbackToHubSpot(
  event: HubSpotCallbackEvent,
): Promise<HubSpotSyncResult> {
  if (!hubspotConfigured()) {
    return { ok: false, skipped: true, error: "HUBSPOT_NOT_CONFIGURED" };
  }

  let createdContact = false;
  let contactId = await searchContactId(event.phoneE164);
  if (!contactId) {
    const created = await createContact(event);
    if (!created.id) {
      return { ok: false, error: created.error ?? "create_contact_failed" };
    }
    contactId = created.id;
    createdContact = true;
  } else {
    await patchContact(contactId, event);
  }

  // Prefer Call engagement for voice callbacks; notes for SMS/manual
  if (event.channel === "VOICE_CALLBACK") {
    const call = await createCallEngagement(contactId, event);
    if (call.id) {
      return {
        ok: true,
        contactId,
        engagementId: call.id,
        engagementType: "call",
        createdContact,
      };
    }
    // Fall through to note if calls scope missing
  }

  const note = await createNoteEngagement(contactId, event);
  if (!note.id) {
    return {
      ok: false,
      error: note.error ?? "create_engagement_failed",
    };
  }
  return {
    ok: true,
    contactId,
    engagementId: note.id,
    engagementType: "note",
    createdContact,
  };
}
