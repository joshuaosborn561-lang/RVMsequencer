import { NextResponse } from "next/server";
import { importLeadsFromSignedCsvUrl } from "@/lib/leads/import-from-csv";
import { guardApiRateLimit } from "@/lib/security/api-guard";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const limited = await guardApiRateLimit(request, "leads");
  if (limited) return limited;

  try {
    const { id } = await context.params;
    const body = (await request.json()) as {
      url?: string;
      mapping?: {
        phone?: string;
        firstName?: string;
        lastName?: string;
        email?: string;
        company?: string;
      };
      mode?: "append" | "replace";
    };

    if (!body.url || typeof body.url !== "string") {
      return NextResponse.json(
        { error: "url is required (signed HTTPS CSV URL)" },
        { status: 400 },
      );
    }

    const result = await importLeadsFromSignedCsvUrl({
      campaignId: id,
      url: body.url,
      mapping: body.mapping,
      mode: body.mode,
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Import failed";
    const status = message.startsWith("Campaign not found")
      ? 404
      : message.includes("url") ||
          message.includes("CSV") ||
          message.includes("phone") ||
          message.includes("column") ||
          message.includes("empty") ||
          message.includes("download")
        ? 400
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
