export const DEFAULT_STALE_THRESHOLD_MS = 60_000;

export interface DrandRoundInfo {
  genesis_time: number;
  period: number;
}

/** Unix seconds at which round R is scheduled. Drand round 1 is at genesis. */
export function drandRoundTime(round: number, info: DrandRoundInfo): number {
  if (!Number.isSafeInteger(round) || round < 1) throw new Error("Drand round must be a positive safe integer");
  if (!Number.isSafeInteger(info.genesis_time) || info.genesis_time < 0 ||
      !Number.isSafeInteger(info.period) || info.period <= 0) {
    throw new Error("Invalid Drand genesis or period");
  }
  const time = info.genesis_time + info.period * (round - 1);
  if (!Number.isSafeInteger(time)) throw new Error("Drand round time exceeds safe integer range");
  return time;
}

export type FreshnessStatus = "fresh" | "stale" | "future" | "unknown";

export interface FreshnessResult {
  status: FreshnessStatus;
  reason?: string;
  publishAtMs?: number;
  ageMs?: number;
}

/**
 * Classifies a Drand round's freshness deterministically using the current time
 * and Drand network info.
 */
export function classifyDrandRound(
  round: number | undefined | null,
  info: DrandRoundInfo | undefined | null,
  nowMs: number,
  staleThresholdMs: number = DEFAULT_STALE_THRESHOLD_MS,
): FreshnessResult {
  if (round == null || round <= 0 || !Number.isSafeInteger(round)) {
    return { status: "unknown", reason: "missing or invalid round" };
  }
  if (!info || typeof info.genesis_time !== "number" || typeof info.period !== "number") {
    return { status: "unknown", reason: "missing or invalid drand info" };
  }
  if (info.period <= 0 || info.genesis_time < 0) {
    return {
      status: "unknown",
      reason: "malformed drand info (negative or zero period/genesis)",
    };
  }
  if (typeof nowMs !== "number" || !Number.isSafeInteger(nowMs) || nowMs < 0) {
    return { status: "unknown", reason: "invalid timestamp" };
  }

  let publishAtMs: number;
  try {
    publishAtMs = drandRoundTime(round, info) * 1000;
    if (!Number.isSafeInteger(publishAtMs)) throw new Error("unsafe timestamp");
  } catch {
    return { status: "unknown", reason: "invalid drand round timing" };
  }

  if (nowMs < publishAtMs) {
    return {
      status: "future",
      reason: "round has not been published yet",
      publishAtMs,
    };
  }

  const ageMs = nowMs - publishAtMs;

  if (ageMs > staleThresholdMs) {
    return {
      status: "stale",
      reason: "round is older than stale threshold",
      publishAtMs,
      ageMs,
    };
  }

  return { status: "fresh", reason: "round is fresh", publishAtMs, ageMs };
}
