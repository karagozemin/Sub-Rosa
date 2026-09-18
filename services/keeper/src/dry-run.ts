import type { Round, RevealStateV3 } from "@sub-rosa/sdk";

import { VOID_GRACE_SECONDS } from "./keeper.js";
import { parseKeeperNetworkConfig } from "./network-config.js";
import {
  countKeeperRevealed,
  readKeeperRevealState,
  readKeeperRound,
  parseKeeperProtocolVersion,
  type KeeperProtocolVersion,
  type KeeperReader,
} from "./protocol.js";

export interface KeeperRunConfig {
  protocolVersion: KeeperProtocolVersion;
  contractId: string;
  roundId: bigint;
  rpcUrl: string;
  networkPassphrase: string;
  dryRun: boolean;
  keeperSecret?: string;
  maxWaitSeconds: number;
}

export type KeeperDryRunPhase =
  | "awaiting-drand"
  | "awaiting-owner"
  | "awaiting-void"
  | "stale-open"
  | "revealing"
  | "awaiting-clear"
  | "ready-to-clear"
  | "ready-to-settle"
  | "complete";

export interface KeeperDryRunDecision {
  currentPhase: KeeperDryRunPhase;
  nextAction: string;
}

export interface KeeperDryRunSummary extends KeeperDryRunDecision {
  mode: "dry-run";
  roundId: bigint;
  status: Round["status"]["tag"];
  drandRound: bigint;
  bidderCount: number;
  revealedCount: number | null;
  transactionsSubmitted: 0;
}

export type KeeperDryRunReader = KeeperReader;

function parseBooleanEnv(value: string | undefined, name: string): boolean {
  if (value == null || value.trim() === "") return false;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  throw new Error(
    `${name} must be one of true/false, 1/0, yes/no, or on/off`,
  );
}

function parseRoundId(value: string | undefined): bigint {
  const raw = value?.trim() || "1";
  try {
    const roundId = BigInt(raw);
    if (roundId < 1n) throw new Error();
    return roundId;
  } catch {
    throw new Error(`ROUND_ID must be a positive integer, got ${JSON.stringify(raw)}`);
  }
}

function parseMaxWaitSeconds(value: string | undefined): number {
  const raw = value?.trim() || "0";
  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new Error(
      `MAX_WAIT_SECONDS must be a non-negative finite number, got ${JSON.stringify(raw)}`,
    );
  }
  return seconds;
}

export function parseKeeperRunConfig(
  env: Record<string, string | undefined> = process.env,
): KeeperRunConfig {
  const dryRun = parseBooleanEnv(env.KEEPER_DRY_RUN, "KEEPER_DRY_RUN");
  const keeperSecret = env.KEEPER_SECRET?.trim() || undefined;
  if (!dryRun && !keeperSecret) {
    throw new Error(
      "missing required env var KEEPER_SECRET (not required when KEEPER_DRY_RUN=true)",
    );
  }
  const network = parseKeeperNetworkConfig(env);

  return {
    protocolVersion: parseKeeperProtocolVersion(env),
    contractId: network.contractId,
    roundId: parseRoundId(env.ROUND_ID),
    rpcUrl: network.rpcUrl,
    networkPassphrase: network.networkPassphrase,
    dryRun,
    ...(keeperSecret ? { keeperSecret } : {}),
    maxWaitSeconds: parseMaxWaitSeconds(env.MAX_WAIT_SECONDS),
  };
}

export function decideKeeperDryRunAction(
  round: Pick<Round, "status" | "reveal_deadline">,
  bidderCount: number,
  revealedCount: number | null,
  nowSeconds = Math.floor(Date.now() / 1000),
  revealState?: RevealStateV3,
): KeeperDryRunDecision {
  switch (round.status.tag) {
    case "Open": {
      const voidAfter = Number(round.reveal_deadline) + VOID_GRACE_SECONDS;
      if (revealState && nowSeconds <= voidAfter) {
        if (nowSeconds > Number(round.reveal_deadline)) {
          return { currentPhase: "awaiting-void", nextAction: `void after grace ${voidAfter}` };
        }
        if (revealState.policy.tag === "OwnerTriggered" && nowSeconds < Number(revealState.policy.values[0])) {
          return { currentPhase: "awaiting-owner", nextAction: `owner may open after Drand publication; permissionless fallback at ${revealState.policy.values[0]}` };
        }
      }
      return nowSeconds > voidAfter
        ? { currentPhase: "stale-open", nextAction: "void stale round" }
        : {
            currentPhase: "awaiting-drand",
            nextAction: "open reveal when the configured Drand round is published",
          };
    }
    case "Revealing": {
      if (nowSeconds > Number(round.reveal_deadline)) {
        return { currentPhase: "ready-to-clear", nextAction: "clear round" };
      }
      const pending =
        revealedCount == null ? null : Math.max(0, bidderCount - revealedCount);
      if (pending == null || pending > 0) {
        return {
          currentPhase: "revealing",
          nextAction:
            pending == null
              ? "inspect bidder states and reveal pending bids"
              : `reveal ${pending} pending bidder${pending === 1 ? "" : "s"}`,
        };
      }
      return {
        currentPhase: "awaiting-clear",
        nextAction: `wait for reveal deadline ${round.reveal_deadline}`,
      };
    }
    case "Cleared":
      return { currentPhase: "ready-to-settle", nextAction: "settle round" };
    case "Settled":
      return { currentPhase: "complete", nextAction: "none — round settled" };
    case "Voided":
      return {
        currentPhase: "complete",
        nextAction: "none — round voided and escrow refunded",
      };
  }
}

export async function buildKeeperDryRunSummary(
  reader: KeeperDryRunReader,
  roundId: bigint | number,
  nowSeconds = Math.floor(Date.now() / 1000),
  protocolVersion: KeeperProtocolVersion = 1,
): Promise<KeeperDryRunSummary> {
  const rid = BigInt(roundId);
  const round = await readKeeperRound(reader, rid, protocolVersion);
  const bidderCount = round.bidders.length;
  const revealedCount = await countKeeperRevealed(
    reader,
    rid,
    round.bidders,
    protocolVersion,
  );
  const decision = decideKeeperDryRunAction(
    round,
    bidderCount,
    revealedCount,
    nowSeconds,
    round.status.tag === "Open" ? await readKeeperRevealState(reader, rid, round) : undefined,
  );

  return {
    mode: "dry-run",
    roundId: rid,
    status: round.status.tag,
    drandRound: round.reveal_round,
    bidderCount,
    revealedCount,
    ...decision,
    transactionsSubmitted: 0,
  };
}
