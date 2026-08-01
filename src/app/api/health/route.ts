import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    ok: true,
    app: "RVM Drop",
    time: new Date().toISOString(),
  });
}
