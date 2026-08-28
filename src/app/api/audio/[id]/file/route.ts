import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { getAudioAsset } from "@/lib/store/db";

type Ctx = { params: Promise<{ id: string }> };

/** Public file URL for Slybroadcast c_url (uploaded assets only). */
export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const asset = await getAudioAsset(id);
  if (!asset?.localPath) {
    return NextResponse.json(
      { error: "not_found", hint: "Only uploaded assets are served here; URL assets are external." },
      { status: 404 },
    );
  }
  try {
    const buf = await readFile(asset.localPath);
    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": asset.contentType || "audio/wav",
        "Cache-Control": "public, max-age=86400",
        "Content-Length": String(buf.length),
      },
    });
  } catch {
    return NextResponse.json({ error: "file_missing" }, { status: 404 });
  }
}
