export type DncScrubResult = {
  phoneE164: string;
  /** True if number should not be contacted */
  blocked: boolean;
  reasons: Array<"FEDERAL_DNC" | "STATE_DNC" | "LITIGATOR" | "INTERNAL" | "OPTED_OUT" | "INVALID">;
  provider: "INTERNAL" | "DNC_PROJECT" | "MOCK";
  raw?: unknown;
};

export type DncScrubber = {
  id: string;
  scrub(numbers: string[]): Promise<DncScrubResult[]>;
};
