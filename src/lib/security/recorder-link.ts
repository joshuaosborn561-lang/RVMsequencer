import { createHmac, timingSafeEqual } from "node:crypto";

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function requireSecret(): string {
  const secret = process.env.RECORDER_LINK_SECRET?.trim();
  if (!secret) {
    throw new Error(
      "RECORDER_LINK_SECRET is required for recording links (set in env)",
    );
  }
  return secret;
}

function sign(campaignId: string, expiresAtMs: number): string {
  return createHmac("sha256", requireSecret())
    .update(`${campaignId}.${expiresAtMs}`)
    .digest("hex");
}

/** Token format: `${expiresAtMs}.${hmacHex}` */
export function createRecorderToken(
  campaignId: string,
  ttlMs: number = DEFAULT_TTL_MS,
): { token: string; expiresAt: string; expiresAtMs: number } {
  const expiresAtMs = Date.now() + Math.max(60_000, ttlMs);
  const token = `${expiresAtMs}.${sign(campaignId, expiresAtMs)}`;
  return {
    token,
    expiresAtMs,
    expiresAt: new Date(expiresAtMs).toISOString(),
  };
}

export function verifyRecorderToken(
  campaignId: string,
  token: string | null | undefined,
): { ok: true; expiresAtMs: number } | { ok: false; reason: string } {
  try {
    requireSecret();
  } catch {
    return { ok: false, reason: "secret_missing" };
  }
  if (!token || typeof token !== "string") {
    return { ok: false, reason: "missing" };
  }
  const dot = token.indexOf(".");
  if (dot <= 0) return { ok: false, reason: "malformed" };
  const expiresRaw = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  const expiresAtMs = Number(expiresRaw);
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= 0) {
    return { ok: false, reason: "malformed" };
  }
  if (Date.now() > expiresAtMs) {
    return { ok: false, reason: "expired" };
  }
  const expected = sign(campaignId, expiresAtMs);
  try {
    const a = Buffer.from(signature, "utf8");
    const b = Buffer.from(expected, "utf8");
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return { ok: false, reason: "invalid" };
    }
  } catch {
    return { ok: false, reason: "invalid" };
  }
  return { ok: true, expiresAtMs };
}

export function recorderLinkUrl(input: {
  campaignId: string;
  token: string;
  baseUrl?: string;
}): string {
  const base = (
    input.baseUrl ||
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ||
    "http://127.0.0.1:3000"
  ).replace(/\/$/, "");
  return `${base}/record/${encodeURIComponent(input.campaignId)}?t=${encodeURIComponent(input.token)}`;
}

export const RECORDER_DEFAULT_TTL_HOURS = 168;
