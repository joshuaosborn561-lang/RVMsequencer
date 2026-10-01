export const VERIPHONE_VERIFY_URL = "https://api.veriphone.io/v2/verify";

export const VERIPHONE_PHONE_TYPES = [
  "mobile",
  "fixed_line",
  "toll_free",
  "premium_rate",
  "shared_cost",
  "voip",
  "unknown",
] as const;

export type VeriphonePhoneType = (typeof VERIPHONE_PHONE_TYPES)[number] | string;

export type VeriphoneCacheEntry = {
  e164: string;
  phoneValid: boolean;
  phoneType: string;
  carrier?: string;
  country?: string;
  checkedAt: string;
  expiresAt: string;
};

export type VeriphoneApiSuccess = {
  phone_valid: boolean;
  phone_type?: string;
  carrier?: string;
  e164?: string;
  country?: string;
};

export type VeriphoneLookupOk = {
  status: "ok";
  phoneValid: boolean;
  phoneType: string;
  carrier?: string;
  country?: string;
  e164: string;
  cached: boolean;
};

export type VeriphoneLookupPaused = {
  status: "paused";
  httpStatus: 401 | 402;
  message: string;
};

export type VeriphoneLookupUnverified = {
  status: "unverified";
  message: string;
  transient: boolean;
};

export type VeriphoneLookupResult =
  | VeriphoneLookupOk
  | VeriphoneLookupPaused
  | VeriphoneLookupUnverified;

export type MobileGateDecision =
  | {
      allow: true;
      source: "disabled" | "cache" | "lead" | "api";
      phoneType?: string;
      phoneValid?: boolean;
    }
  | {
      allow: false;
      reason: "NOT_MOBILE";
      detail: string;
      phoneType: string;
      source: "cache" | "lead" | "api";
    }
  | {
      allow: false;
      reason: "PHONE_UNVERIFIED";
      detail: string;
      source: "paused" | "error" | "disabled_paused";
    };

export function normalizePhoneType(raw: string | null | undefined): string {
  const cleaned = (raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
  return cleaned || "unknown";
}

/** Terminal suppress reason: NOT_MOBILE_VERIPHONE_<type> */
export function notMobileReason(phoneType: string | null | undefined): string {
  return `NOT_MOBILE_VERIPHONE_${normalizePhoneType(phoneType)}`;
}

export function isMobileLine(phoneValid: boolean, phoneType: string): boolean {
  return phoneValid === true && normalizePhoneType(phoneType) === "mobile";
}
