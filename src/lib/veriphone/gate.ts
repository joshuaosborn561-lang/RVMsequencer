import { VERIPHONE_CACHE_TTL_MS } from "@/lib/hardening/constants";
import {
  entryFromLookup,
  getPhoneTypeCache,
  putPhoneTypeCache,
} from "./cache";
import { isVeriphoneEnabled, lookupVeriphone } from "./client";
import {
  clearVeriphonePause,
  readVeriphonePauseState,
} from "./state";
import {
  isMobileLine,
  notMobileReason,
  type MobileGateDecision,
  type VeriphoneCacheEntry,
} from "./types";

export type RecordedLineCheck = {
  phoneType?: string | null;
  phoneValid?: boolean | null;
  phoneVerifiedAt?: string | null;
};

export function recordedResultFresh(
  recorded: RecordedLineCheck | null | undefined,
  now = new Date(),
): boolean {
  if (
    !recorded?.phoneVerifiedAt ||
    typeof recorded.phoneValid !== "boolean" ||
    !recorded.phoneType
  ) {
    return false;
  }
  const at = Date.parse(recorded.phoneVerifiedAt);
  return Number.isFinite(at) && now.getTime() - at < VERIPHONE_CACHE_TTL_MS;
}

function decisionFromEntry(
  entry: Pick<VeriphoneCacheEntry, "phoneValid" | "phoneType">,
  source: "cache" | "lead" | "api",
): MobileGateDecision {
  if (isMobileLine(entry.phoneValid, entry.phoneType)) {
    return {
      allow: true,
      source,
      phoneType: entry.phoneType,
      phoneValid: true,
    };
  }
  return {
    allow: false,
    reason: "NOT_MOBILE",
    detail: notMobileReason(entry.phoneType || (entry.phoneValid ? "unknown" : "invalid")),
    phoneType: entry.phoneType || (entry.phoneValid ? "unknown" : "invalid"),
    source,
  };
}

async function persistOk(
  requestedE164: string,
  result: Extract<Awaited<ReturnType<typeof lookupVeriphone>>, { status: "ok" }>,
  now: Date,
): Promise<VeriphoneCacheEntry> {
  const entry = entryFromLookup({
    e164: requestedE164,
    phoneValid: result.phoneValid,
    phoneType: result.phoneType,
    carrier: result.carrier,
    country: result.country,
    now,
  });
  await putPhoneTypeCache(entry);
  if (result.e164 && result.e164 !== requestedE164) {
    await putPhoneTypeCache({ ...entry, e164: result.e164 });
  }
  return entry;
}

/**
 * HARD mobile-line gate. Disabled (allow) when VERIPHONE_API_KEY is unset.
 * Never sends when enabled and the number is unverified or paused.
 */
export async function evaluateMobileGate(
  phoneE164: string,
  opts?: {
    recorded?: RecordedLineCheck | null;
    now?: Date;
    /** When paused, default is skip HTTP. Set true to probe once for resume. */
    probeEvenIfPaused?: boolean;
  },
): Promise<MobileGateDecision> {
  const now = opts?.now ?? new Date();
  if (!isVeriphoneEnabled()) {
    return { allow: true, source: "disabled" };
  }

  const cached = await getPhoneTypeCache(phoneE164, now);
  if (cached) return decisionFromEntry(cached, "cache");

  if (recordedResultFresh(opts?.recorded, now)) {
    return decisionFromEntry(
      {
        phoneValid: opts!.recorded!.phoneValid === true,
        phoneType: opts!.recorded!.phoneType as string,
      },
      "lead",
    );
  }

  const paused = await readVeriphonePauseState();
  if (paused.paused && !opts?.probeEvenIfPaused) {
    return {
      allow: false,
      reason: "PHONE_UNVERIFIED",
      detail: paused.pausedReason ?? "VERIPHONE_PAUSED",
      source: "paused",
    };
  }

  const lookup = await lookupVeriphone(phoneE164);
  if (lookup.status === "paused") {
    return {
      allow: false,
      reason: "PHONE_UNVERIFIED",
      detail: lookup.httpStatus === 401 ? "VERIPHONE_HTTP_401" : "VERIPHONE_HTTP_402",
      source: "paused",
    };
  }
  if (lookup.status === "unverified") {
    return {
      allow: false,
      reason: "PHONE_UNVERIFIED",
      detail: lookup.message,
      source: "error",
    };
  }

  await clearVeriphonePause();
  const entry = await persistOk(phoneE164, lookup, now);
  return decisionFromEntry(entry, "api");
}

export type VerifyPhoneOutcome =
  | {
      kind: "mobile";
      phoneType: string;
      phoneValid: true;
      carrier?: string;
      country?: string;
      source: "cache" | "lead" | "api";
    }
  | {
      kind: "not_mobile";
      reason: string;
      phoneType: string;
      phoneValid: boolean;
      source: "cache" | "lead" | "api";
    }
  | { kind: "unverified"; detail: string; paused: boolean }
  | { kind: "disabled" };

/** Cache-aware verify used on ingest and before claim. */
export async function verifyPhoneForGate(
  phoneE164: string,
  opts?: {
    recorded?: RecordedLineCheck | null;
    now?: Date;
    probeEvenIfPaused?: boolean;
  },
): Promise<VerifyPhoneOutcome> {
  const decision = await evaluateMobileGate(phoneE164, opts);
  if (decision.allow && decision.source === "disabled") {
    return { kind: "disabled" };
  }
  if (decision.allow) {
    return {
      kind: "mobile",
      phoneType: decision.phoneType ?? "mobile",
      phoneValid: true,
      source: decision.source === "disabled" ? "cache" : decision.source,
    };
  }
  if (decision.reason === "NOT_MOBILE") {
    return {
      kind: "not_mobile",
      reason: decision.detail,
      phoneType: decision.phoneType,
      phoneValid: false,
      source: decision.source,
    };
  }
  return {
    kind: "unverified",
    detail: decision.detail,
    paused: decision.source === "paused",
  };
}
