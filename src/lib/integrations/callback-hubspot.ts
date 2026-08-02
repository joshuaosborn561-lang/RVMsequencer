import { syncCallbackToHubSpot, type HubSpotSyncResult } from "@/lib/integrations/hubspot";
import {
  getCampaign,
  getClient,
  listCampaigns,
  listLeads,
  listLines,
} from "@/lib/store/db";

export type CallbackSyncInput = {
  phoneE164: string;
  didE164?: string;
  channel: "VOICE_CALLBACK" | "SMS" | "NOTE";
  body: string;
  providerEventId?: string;
  /** Prefer when known (inbox already tagged to a campaign). */
  campaignId?: string;
  clientId?: string;
};

function digits(value: string): string {
  return value.replace(/\D/g, "");
}

/**
 * Resolve owning client from DID → phone line → campaign.lineIds → campaign.clientId,
 * then sync to HubSpot only if that client has hubspotOptIn.
 */
export async function syncCallbackIfClientOptedIn(
  input: CallbackSyncInput,
): Promise<HubSpotSyncResult & { clientId?: string; campaignId?: string }> {
  const resolved = await resolveClientForCallback(input);
  if (!resolved.client) {
    return {
      ok: false,
      skipped: true,
      error: "NO_CLIENT_FOR_CALLBACK",
      campaignId: resolved.campaignId,
    };
  }
  if (!resolved.client.hubspotOptIn) {
    return {
      ok: false,
      skipped: true,
      error: "CLIENT_NOT_OPTED_IN",
      clientId: resolved.client.id,
      campaignId: resolved.campaignId,
    };
  }

  let firstName: string | undefined;
  let lastName: string | undefined;
  let company: string | undefined;
  let email: string | undefined;
  if (resolved.campaignId) {
    const leads = await listLeads(resolved.campaignId);
    const lead = leads.find((l) => l.phoneE164 === input.phoneE164);
    if (lead) {
      firstName = lead.firstName;
      lastName = lead.lastName;
      company = lead.company;
      email = lead.email;
    }
  }

  const campaign = resolved.campaignId
    ? await getCampaign(resolved.campaignId)
    : null;

  const result = await syncCallbackToHubSpot({
    phoneE164: input.phoneE164,
    didE164: input.didE164,
    channel: input.channel,
    body: input.body,
    campaignId: resolved.campaignId,
    campaignName: campaign?.name,
    clientId: resolved.client.id,
    clientName: resolved.client.name,
    providerEventId: input.providerEventId,
    ownerId: resolved.client.hubspotOwnerId,
    firstName,
    lastName,
    company,
    email,
  });

  return {
    ...result,
    clientId: resolved.client.id,
    campaignId: resolved.campaignId,
  };
}

/** Attach campaign/client ownership for a DID used on inbound webhooks. */
export async function resolveOwnerFromDid(didE164: string): Promise<{
  lineId?: string;
  campaignId?: string;
  clientId?: string;
}> {
  const lines = await listLines();
  const didDigits = digits(didE164);
  const line = lines.find(
    (l) => l.e164 === didE164 || digits(l.e164) === didDigits,
  );
  if (!line) return {};

  const campaigns = await listCampaigns();
  const campaign = campaigns.find(
    (c) =>
      c.lineIds.includes(line.id) &&
      c.status !== "ARCHIVED" &&
      Boolean(c.clientId),
  );
  return {
    lineId: line.id,
    campaignId: campaign?.id,
    clientId: campaign?.clientId,
  };
}

async function resolveClientForCallback(input: CallbackSyncInput): Promise<{
  client: Awaited<ReturnType<typeof getClient>>;
  campaignId?: string;
}> {
  if (input.clientId) {
    return { client: await getClient(input.clientId), campaignId: input.campaignId };
  }

  if (input.campaignId) {
    const campaign = await getCampaign(input.campaignId);
    if (campaign?.clientId) {
      return {
        client: await getClient(campaign.clientId),
        campaignId: campaign.id,
      };
    }
  }

  if (!input.didE164?.trim()) return { client: null };

  const owner = await resolveOwnerFromDid(input.didE164);
  if (!owner.clientId) {
    return { client: null, campaignId: owner.campaignId };
  }
  return {
    client: await getClient(owner.clientId),
    campaignId: owner.campaignId,
  };
}
