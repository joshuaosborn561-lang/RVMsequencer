import { NextResponse } from "next/server";
import { z } from "zod";
import { listInbox, updateInboxMessage } from "@/lib/store/db";

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
  return NextResponse.json({ message });
}
