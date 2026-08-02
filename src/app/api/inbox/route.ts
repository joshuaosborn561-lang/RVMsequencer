import { NextResponse } from "next/server";
import { z } from "zod";
import { syncCallbackIfClientOptedIn } from "@/lib/integrations/callback-hubspot";
import {
  listInbox,
  suppressLeadByPhone,
  updateInboxMessage,
} from "@/lib/store/db";

export async function GET(req: Request) {
  const clientId = new URL(req.url).searchParams.get("clientId") ?? undefined;
  return NextResponse.json({ messages: await listInbox(clientId) });
}

const PatchBody = z.object({
  id: z.string(),
  category: z
    .enum(["UNREAD", "INTERESTED", "NOT_INTERESTED", "CALLBACK", "DNC", "OTHER"])
    .optional(),
  readAt: z.string().optional(),
});

export async function PATCH(req: Request) {
  const parsed = PatchBody.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { id, ...patch } = parsed.data;
  const message = await updateInboxMessage(id, patch);
  if (!message) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  if (patch.category === "DNC") {
    await suppressLeadByPhone(message.fromE164, "INBOX_DNC", {
      optOut: true,
      markDnc: true,
    });
  }
  if (patch.category === "CALLBACK") {
    await suppressLeadByPhone(message.fromE164, "INBOX_CALLBACK");
    void syncCallbackIfClientOptedIn({
      phoneE164: message.fromE164,
      didE164: message.toE164,
      channel: message.channel,
      body: message.body,
      providerEventId: message.providerEventId,
      campaignId: message.campaignId,
      clientId: message.clientId,
    }).catch((err) => console.error("[hubspot] inbox callback sync failed", err));
  }

  return NextResponse.json({ message });
}
