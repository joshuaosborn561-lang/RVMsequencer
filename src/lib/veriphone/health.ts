import { isVeriphoneConfigured, logVeriphoneDisabledOnce } from "./client";
import { readVeriphonePauseState } from "./state";

export type VeriphoneHealth = {
  enabled: boolean;
  paused: boolean;
  flag: "ok" | "disabled" | "paused";
  error: string | null;
  pausedReason?: string;
};

export async function getVeriphoneHealth(): Promise<VeriphoneHealth> {
  if (!isVeriphoneConfigured()) {
    logVeriphoneDisabledOnce();
    return {
      enabled: false,
      paused: false,
      flag: "disabled",
      error: null,
    };
  }
  const state = await readVeriphonePauseState();
  if (state.paused) {
    return {
      enabled: true,
      paused: true,
      flag: "paused",
      error: state.lastError ?? state.pausedReason ?? "VERIPHONE_PAUSED",
      pausedReason: state.pausedReason,
    };
  }
  return {
    enabled: true,
    paused: false,
    flag: "ok",
    error: null,
  };
}
