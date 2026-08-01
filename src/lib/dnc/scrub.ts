import { toE164 } from "@/lib/phone";
import type { DncScrubResult, DncScrubber } from "./types";

/** Always-on workspace suppression list (opt-outs, manual blocks). */
export function createInternalDncScrubber(blocked: Set<string>): DncScrubber {
  const normalized = new Set(
    [...blocked].map((p) => toE164(p)).filter((p): p is string => Boolean(p)),
  );
  return {
    id: "INTERNAL",
    async scrub(numbers) {
      return numbers.map((n) => {
        const e164 = toE164(n);
        if (!e164) {
          return {
            phoneE164: n,
            blocked: true,
            reasons: ["INVALID"],
            provider: "INTERNAL" as const,
          };
        }
        const hit = normalized.has(e164);
        return {
          phoneE164: e164,
          blocked: hit,
          reasons: hit ? (["INTERNAL"] as const) : [],
          provider: "INTERNAL" as const,
        };
      });
    },
  };
}

/**
 * The DNC Project — PAYG national/state/litigator scrub API.
 * Docs: https://thedncproject.org/api-documentation
 * POST /api/v2/scrubs  Authorization: Bearer <token>
 */
export function createDncProjectScrubber(config: {
  apiToken?: string;
  baseUrl?: string;
  scrubTypes?: Array<"dnc" | "state" | "litigator" | "mobile">;
}): DncScrubber {
  const baseUrl = config.baseUrl ?? "https://thedncproject.org";
  const scrubTypes = config.scrubTypes ?? ["dnc", "state", "litigator"];

  return {
    id: "DNC_PROJECT",
    async scrub(numbers) {
      if (!config.apiToken) {
        // Fail closed when scrub is required but unconfigured
        return numbers.map((n) => ({
          phoneE164: toE164(n) ?? n,
          blocked: true,
          reasons: ["INVALID"] as DncScrubResult["reasons"],
          provider: "DNC_PROJECT" as const,
          raw: { error: "DNC_PROJECT_API_TOKEN not set" },
        }));
      }

      const normalized = numbers
        .map((n) => toE164(n))
        .filter((n): n is string => Boolean(n));

      const res = await fetch(`${baseUrl}/api/v2/scrubs`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          numbers: normalized,
          scrub_type: scrubTypes,
        }),
      });

      const raw: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(`DNC Project scrub failed HTTP ${res.status}`);
      }

      // Response shapes vary; normalize common fields.
      const rows = Array.isArray(raw)
        ? raw
        : raw && typeof raw === "object" && "results" in raw
          ? (raw as { results: unknown[] }).results
          : [];

      const byPhone = new Map<string, DncScrubResult>();
      for (const row of rows) {
        if (!row || typeof row !== "object") continue;
        const r = row as Record<string, unknown>;
        const phone = toE164(String(r.number ?? r.phone ?? r.phone_number ?? ""));
        if (!phone) continue;
        const reasons: DncScrubResult["reasons"] = [];
        const dncHit =
          r.dnc === true ||
          r.on_dnc === true ||
          r.national_dnc === true ||
          String(r.dnc_status ?? "").toLowerCase() === "listed";
        const stateHit = r.state_dnc === true || r.on_state_dnc === true;
        const litHit = r.litigator === true || r.is_litigator === true;
        if (dncHit) reasons.push("FEDERAL_DNC");
        if (stateHit) reasons.push("STATE_DNC");
        if (litHit) reasons.push("LITIGATOR");
        byPhone.set(phone, {
          phoneE164: phone,
          blocked: reasons.length > 0,
          reasons,
          provider: "DNC_PROJECT",
          raw: row,
        });
      }

      return numbers.map((n) => {
        const e164 = toE164(n);
        if (!e164) {
          return {
            phoneE164: n,
            blocked: true,
            reasons: ["INVALID"],
            provider: "DNC_PROJECT" as const,
          };
        }
        return (
          byPhone.get(e164) ?? {
            phoneE164: e164,
            blocked: false,
            reasons: [],
            provider: "DNC_PROJECT" as const,
            raw,
          }
        );
      });
    },
  };
}

/** Deterministic mock: numbers ending in 0000 are “on DNC”. */
export const mockDncScrubber: DncScrubber = {
  id: "MOCK",
  async scrub(numbers) {
    return numbers.map((n) => {
      const e164 = toE164(n) ?? n;
      const digits = e164.replace(/\D/g, "");
      const blocked = digits.endsWith("0000");
      return {
        phoneE164: e164,
        blocked,
        reasons: blocked ? (["FEDERAL_DNC"] as const) : [],
        provider: "MOCK" as const,
      };
    });
  },
};

/** Merge scrubbers: blocked if any scrubber blocks. */
export async function scrubWithAll(
  scrubbers: DncScrubber[],
  numbers: string[],
): Promise<DncScrubResult[]> {
  const merged = new Map<string, DncScrubResult>();
  for (const n of numbers) {
    const e164 = toE164(n) ?? n;
    merged.set(e164, {
      phoneE164: e164,
      blocked: false,
      reasons: [],
      provider: "INTERNAL",
    });
  }
  for (const scrubber of scrubbers) {
    const results = await scrubber.scrub(numbers);
    for (const r of results) {
      const prev = merged.get(r.phoneE164) ?? {
        phoneE164: r.phoneE164,
        blocked: false,
        reasons: [],
        provider: r.provider,
      };
      merged.set(r.phoneE164, {
        phoneE164: r.phoneE164,
        blocked: prev.blocked || r.blocked,
        reasons: [...new Set([...prev.reasons, ...r.reasons])],
        provider: r.blocked ? r.provider : prev.provider,
        raw: r.raw ?? prev.raw,
      });
    }
  }
  return numbers.map((n) => {
    const e164 = toE164(n) ?? n;
    return merged.get(e164)!;
  });
}
