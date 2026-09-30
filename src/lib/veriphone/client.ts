import {
  VERIPHONE_MAX_RETRIES,
  VERIPHONE_MIN_INTERVAL_MS,
} from "@/lib/hardening/constants";
import { pauseVeriphone } from "./state";
import {
  normalizePhoneType,
  VERIPHONE_VERIFY_URL,
  type VeriphoneApiSuccess,
  type VeriphoneLookupResult,
} from "./types";

export type VeriphoneTestHooks = {
  fetchFn?: typeof fetch;
  sleepFn?: (ms: number) => Promise<void>;
  nowFn?: () => number;
};

let hooks: VeriphoneTestHooks = {};
let lastHttpAt = 0;
let loggedDisabled = false;

export function setVeriphoneTestHooks(next: VeriphoneTestHooks): void {
  hooks = next;
}

export function resetVeriphoneTestHooks(): void {
  hooks = {};
  lastHttpAt = 0;
  loggedDisabled = false;
}

export function isVeriphoneConfigured(): boolean {
  return Boolean(process.env.VERIPHONE_API_KEY?.trim());
}

export function logVeriphoneDisabledOnce(): void {
  if (loggedDisabled || isVeriphoneConfigured()) return;
  loggedDisabled = true;
  console.warn(
    "[veriphone] VERIPHONE_API_KEY is unset — mobile-line gate disabled. Existing send behavior is unchanged.",
  );
}

export function isVeriphoneEnabled(): boolean {
  const on = isVeriphoneConfigured();
  if (!on) logVeriphoneDisabledOnce();
  return on;
}

function sleep(ms: number): Promise<void> {
  if (hooks.sleepFn) return hooks.sleepFn(ms);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nowMs(): number {
  return hooks.nowFn ? hooks.nowFn() : Date.now();
}

async function pace(): Promise<void> {
  const elapsed = nowMs() - lastHttpAt;
  if (lastHttpAt > 0 && elapsed < VERIPHONE_MIN_INTERVAL_MS) {
    await sleep(VERIPHONE_MIN_INTERVAL_MS - elapsed);
  }
  lastHttpAt = nowMs();
}

function parseSuccess(json: unknown, fallbackE164: string): VeriphoneLookupResult {
  if (!json || typeof json !== "object") {
    return {
      status: "unverified",
      message: "veriphone_invalid_json",
      transient: true,
    };
  }
  const body = json as Partial<VeriphoneApiSuccess> & { status?: string };
  if (typeof body.phone_valid !== "boolean") {
    return {
      status: "unverified",
      message: "veriphone_missing_phone_valid",
      transient: true,
    };
  }
  const phoneType = normalizePhoneType(body.phone_type);
  return {
    status: "ok",
    phoneValid: body.phone_valid,
    phoneType,
    carrier: typeof body.carrier === "string" ? body.carrier : undefined,
    country: typeof body.country === "string" ? body.country : undefined,
    e164:
      typeof body.e164 === "string" && body.e164.trim()
        ? body.e164.trim()
        : fallbackE164,
    cached: false,
  };
}

/**
 * Paid Veriphone lookup. Caller is responsible for cache + enablement checks.
 * Never logs the API key.
 */
export async function lookupVeriphone(
  phoneE164: string,
): Promise<VeriphoneLookupResult> {
  const key = process.env.VERIPHONE_API_KEY?.trim();
  if (!key) {
    return {
      status: "unverified",
      message: "veriphone_key_missing",
      transient: false,
    };
  }

  const url = new URL(VERIPHONE_VERIFY_URL);
  url.searchParams.set("phone", phoneE164);
  url.searchParams.set("key", key);

  let lastMessage = "veriphone_request_failed";
  for (let attempt = 0; attempt <= VERIPHONE_MAX_RETRIES; attempt++) {
    await pace();
    try {
      const fetchFn = hooks.fetchFn ?? fetch;
      const res = await fetchFn(url.toString(), {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
      });

      if (res.status === 401 || res.status === 402) {
        const message =
          res.status === 401
            ? "Veriphone HTTP 401 — API key rejected"
            : "Veriphone HTTP 402 — out of credits";
        await pauseVeriphone({
          httpStatus: res.status,
          message,
        });
        return { status: "paused", httpStatus: res.status, message };
      }

      if (res.status === 429 || res.status >= 500) {
        lastMessage = `veriphone_http_${res.status}`;
        const retryAfter = Number(res.headers.get("retry-after") || 0);
        const wait =
          retryAfter > 0
            ? retryAfter * 1000
            : Math.min(2_000, 200 * 2 ** attempt);
        await sleep(wait);
        continue;
      }

      if (!res.ok) {
        lastMessage = `veriphone_http_${res.status}`;
        if (attempt < VERIPHONE_MAX_RETRIES) {
          await sleep(Math.min(2_000, 200 * 2 ** attempt));
          continue;
        }
        return { status: "unverified", message: lastMessage, transient: true };
      }

      const json: unknown = await res.json();
      return parseSuccess(json, phoneE164);
    } catch (err) {
      lastMessage =
        err instanceof Error ? err.message.slice(0, 180) : "veriphone_network";
      if (attempt < VERIPHONE_MAX_RETRIES) {
        await sleep(Math.min(2_000, 200 * 2 ** attempt));
        continue;
      }
      return { status: "unverified", message: lastMessage, transient: true };
    }
  }

  return { status: "unverified", message: lastMessage, transient: true };
}
