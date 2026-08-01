export type ConsentStatus =
  | "UNKNOWN"
  | "EXPRESS_WRITTEN"
  | "EXPRESS_ORAL"
  | "ESTABLISHED_BUSINESS"
  | "OPTED_OUT";

export type ComplianceInput = {
  consentStatus: ConsentStatus;
  dnc: boolean;
  requireConsent: boolean;
  /** Recipient local hour 0–23 */
  localHour: number;
  sendWindowStart: number;
  sendWindowEnd: number;
  /** JS getDay(): 0=Sun … 6=Sat */
  localDayOfWeek: number;
  sendDays: number[]; // 0–6
};

export type ComplianceDecision =
  | { allow: true }
  | {
      allow: false;
      reason:
        | "DNC"
        | "OPTED_OUT"
        | "MISSING_CONSENT"
        | "OUTSIDE_SEND_WINDOW"
        | "OUTSIDE_SEND_DAYS";
    };

/**
 * Gates before queueing an RVM.
 * DNC / opt-out / send windows are hard.
 * Consent is optional (requireConsent=false by default) for cold-call / grey-area posture.
 */
export function evaluateCompliance(input: ComplianceInput): ComplianceDecision {
  if (input.dnc) return { allow: false, reason: "DNC" };
  if (input.consentStatus === "OPTED_OUT") {
    return { allow: false, reason: "OPTED_OUT" };
  }
  if (input.requireConsent) {
    const ok =
      input.consentStatus === "EXPRESS_WRITTEN" ||
      input.consentStatus === "EXPRESS_ORAL" ||
      input.consentStatus === "ESTABLISHED_BUSINESS";
    if (!ok) return { allow: false, reason: "MISSING_CONSENT" };
  }
  if (!input.sendDays.includes(input.localDayOfWeek)) {
    return { allow: false, reason: "OUTSIDE_SEND_DAYS" };
  }
  if (
    input.localHour < input.sendWindowStart ||
    input.localHour >= input.sendWindowEnd
  ) {
    return { allow: false, reason: "OUTSIDE_SEND_WINDOW" };
  }
  return { allow: true };
}

/** Simple {{var}} interpolation for scripts. */
export function renderScript(
  template: string,
  vars: Record<string, string | undefined | null>,
): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) => {
    const v = vars[key];
    return v == null || v === "" ? "" : String(v);
  }).replace(/\s{2,}/g, " ").trim();
}
