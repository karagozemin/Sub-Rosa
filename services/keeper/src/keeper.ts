import { drandRoundTime } from "@sub-rosa/tlock";
// Permissionless reveal keeper.
//
// Once Drand round R is published, *anyone* can force a sealed round open and
// reveal every bid — no operator, no bidder cooperation. This keeper does
// exactly that, idempotently:
//
//   1. wait until round R is available,
//   2. open the reveal window with R's real Drand signature (verified on-chain),
//   3. read the deterministic bidder index, decrypt each seal with R,
//   4. submit each reveal.
//
// Every step tolerates "already done" states (another keeper, or the operator,
// may have acted first) by checking on-chain state first and treating the
// matching contract errors as skips rather than failures. No relayer, no agent,
// no mock — just the SDK over real RPC and the live Drand beacon.

import type { SubRosaClient } from "@sub-rosa/sdk";
import { RoundErrors } from "@sub-rosa/sdk";
import {
  openBid,
  openPayload,
  fetchRoundSignature,
  type DrandClient,
  type PayloadEnvelope,
} from "@sub-rosa/tlock";

import { readKeeperRevealState, readKeeperRound, type KeeperProtocolVersion } from "./protocol.js";
import type { SettlementGuard } from "./settlement-guard.js";

export type KeeperLogger = (msg: string) => void;

export interface KeeperDeps {
  settlementGuard?: SettlementGuard;
  /** Library calls default to legacy v1; CLI entry points explicitly select v2. */
  protocolVersion?: KeeperProtocolVersion;
  /** A funded signer. The keeper role is permissionless — any account works. */
  sdk: SubRosaClient;
  drand: DrandClient;
  log?: KeeperLogger;
  /** Max seconds to wait for round R. Default 0: act only if R is already out. */
  maxWaitSeconds?: number;
  /** Poll cadence while waiting for R (ms). Default 3000. */
  pollMs?: number;
  /** @internal Structured-payload opener override for deterministic tests. */
  openStructuredPayload?: (
    ciphertext: Uint8Array,
    client: DrandClient,
  ) => Promise<PayloadEnvelope>;
}

export interface SkipRecord {
  bidder: string;
  reason: string;
}

export interface KeeperResult {
  roundId: bigint;
  finalStatus: string;
  /** True if this run moved the round into Revealing (vs. it was already open). */
  openedReveal: boolean;
  revealed: string[];
  skipped: SkipRecord[];
}

// Contract error codes that mean "someone already did this" — safe to skip.
const IDEMPOTENT_OPEN = [
  "RevealAlreadyOpen", "WrongStatus", "AlreadyCleared", "AlreadySettled", "RoundVoided",
];
// Permanent rejection of one participant must not prevent other reveals.
const INVALID_SUBMISSION = [
  "HashMismatch", "MalformedPayload", "InvalidAmount", "BidExceedsEscrow",
  "UnsupportedVersion", "EscrowNotAllowed",
];
const IDEMPOTENT_REVEAL = ["AlreadyRevealed"];

export function errorName(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

export function errorMatches(e: unknown, names: string[]): boolean {
  const seen = new Set<unknown>();
  let current = e;
  while (current != null && !seen.has(current)) {
    seen.add(current);
    let blob = errorName(current);
    try {
      blob += " " + JSON.stringify(current);
    } catch {
      /* Circular error objects can still be matched by their message. */
    }
    if (names.some((name) => blob.includes(name))) return true;
    // Soroban simulation errors may contain only the numeric contract code.
    const code = /Error\(Contract,\s*#(\d+)\)/.exec(blob)?.[1];
    const name = code ? RoundErrors[Number(code) as keyof typeof RoundErrors]?.message : undefined;
    if (name && names.includes(name)) return true;
    current = typeof current === "object" && "cause" in current ? current.cause : undefined;
  }
  return false;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Check and reserve synchronously before awaiting the transaction, so concurrent
 * passes sharing a guard cannot both dispatch settlement. */
async function submitSettlement(
  deps: KeeperDeps,
  roundId: bigint,
  submit: () => Promise<void>,
): Promise<boolean> {
  const guard = deps.settlementGuard;
  const check = guard?.canSettle(roundId);
  if (check && !check.allowed) {
    deps.log?.(JSON.stringify(check.event));
    return false;
  }
  guard?.markSubmitted(roundId);
  try {
    await submit();
    guard?.markTerminal(roundId, "settled on-chain");
    return true;
  } catch (error) {
    guard?.markRetryable(roundId, errorName(error));
    throw error;
  }
}

/** Wait until Drand round R should be published. Returns false if R is still in
 *  the future after `maxWaitSeconds`. */
export async function waitForRound(
  deps: KeeperDeps,
  round: number,
): Promise<boolean> {
  const { drand, log = () => {}, maxWaitSeconds = 0, pollMs = 3000 } = deps;
  const info = await drand.chain().info();
  const publishAtMs = drandRoundTime(round, info) * 1000;
  const giveUpAtMs = Date.now() + maxWaitSeconds * 1000;

  while (Date.now() < publishAtMs) {
    if (Date.now() >= giveUpAtMs) return false;
    const remainS = Math.ceil((publishAtMs - Date.now()) / 1000);
    log(`waiting ~${remainS}s for Drand round ${round}…`);
    await sleep(Math.min(pollMs, Math.max(250, publishAtMs - Date.now())));
  }
  return true;
}

/** Run one full keeper pass over a round: open (if needed) + reveal all. */
export async function keepRound(
  deps: KeeperDeps,
  roundId: bigint | number,
): Promise<KeeperResult> {
  const { sdk, drand, log = () => {} } = deps;
  const rid = BigInt(roundId);
  const result: KeeperResult = {
    roundId: rid,
    finalStatus: "",
    openedReveal: false,
    revealed: [],
    skipped: [],
  };

  let round = await sdk.getRound(rid);
  log(`round ${rid}: status=${round.status.tag} R=${round.reveal_round}`);

  // ── Phase A: open the reveal window with R's real Drand signature ──────
  if (round.status.tag === "Open") {
    const R = Number(round.reveal_round);
    const available = await waitForRound(deps, R);
    if (!available) {
      log(`Drand round ${R} not published yet; nothing to open this pass`);
      result.finalStatus = round.status.tag;
      return result;
    }

    // R's wall-clock time has arrived, but an API replica may lag a beat before
    // it serves the beacon — retry briefly rather than bailing.
    const pollMs = deps.pollMs ?? 3000;
    let signature: Uint8Array | undefined;
    for (let attempt = 0; attempt < 5 && !signature; attempt++) {
      try {
        signature = await fetchRoundSignature(drand, R);
      } catch (e) {
        log(`Drand round ${R} not servable yet (try ${attempt + 1}/5): ${errorName(e)}`);
        await sleep(pollMs);
      }
    }
    if (!signature) {
      log(`gave up fetching Drand round ${R} this pass`);
      result.finalStatus = round.status.tag;
      return result;
    }

    try {
      await sdk.openReveal(rid, signature);
      result.openedReveal = true;
      log(`open_reveal OK (round ${rid} via Drand R=${R})`);
    } catch (e) {
      if (errorMatches(e, IDEMPOTENT_OPEN)) {
        log(`open_reveal already done (${errorName(e)}); continuing`);
      } else {
        throw e;
      }
    }
    round = await sdk.getRound(rid);
  }

  // ── Phase B: decrypt every seal and reveal it ─────────────────────────
  if (round.status.tag === "Revealing") {
    const bidders: string[] = [];
    for await (const addr of sdk.bidders(rid)) bidders.push(addr);
    log(`revealing ${bidders.length} bidder(s)`);

    for (const bidder of bidders) {
      let state;
      try {
        state = await sdk.getBidState(rid, bidder);
      } catch (e) {
        result.skipped.push({ bidder, reason: `state read failed: ${errorName(e)}` });
        continue;
      }
      // Option<i128> None decodes as null/undefined; a revealed bid is a bigint.
      if (state.revealed_value != null) {
        result.skipped.push({ bidder, reason: "already revealed" });
        continue;
      }

      const seal = await sdk.getSeal(rid, bidder);
      if (!seal) {
        result.skipped.push({ bidder, reason: "seal expired/absent" });
        continue;
      }

      let opened;
      try {
        opened = await openBid(new Uint8Array(seal.ciphertext), drand);
      } catch (e) {
        result.skipped.push({ bidder, reason: `decrypt failed: ${errorName(e)}` });
        continue;
      }

      try {
        await sdk.reveal({
          roundId: rid,
          bidder,
          value: opened.value,
          nonce: opened.nonce,
        });
        result.revealed.push(bidder);
        log(`revealed ${bidder} = ${opened.value}`);
      } catch (e) {
        if (errorMatches(e, IDEMPOTENT_REVEAL)) {
          result.skipped.push({ bidder, reason: "already revealed (race)" });
        } else if (errorMatches(e, ["HashMismatch"])) {
          // A reveal that does not hash to H is rejected by the contract; the
          // canonical value is whatever we decrypted, so this only happens for a
          // corrupt seal — record and move on.
          result.skipped.push({ bidder, reason: "hash mismatch (corrupt seal)" });
        } else if (errorMatches(e, INVALID_SUBMISSION)) {
          result.skipped.push({ bidder, reason: `invalid payload: ${errorName(e)}` });
        } else if (errorMatches(e, ["RevealWindowClosed"])) {
          result.skipped.push({ bidder, reason: "reveal window closed" });
        } else {
          throw e;
        }
      }
    }
    round = await sdk.getRound(rid);
  } else if (round.status.tag !== "Open") {
    log(`round ${rid} is ${round.status.tag}; nothing to reveal`);
  }

  result.finalStatus = round.status.tag;
  return result;
}

/** Core v2 keeper pass. Opens structured payloads and reveals the complete
 * canonical envelope, preserving every partner-defined submission byte. */
export async function keepRoundV2(
  deps: KeeperDeps,
  roundId: bigint | number,
): Promise<KeeperResult> {
  const { sdk, drand, log = () => {} } = deps;
  const rid = BigInt(roundId);
  const result: KeeperResult = {
    roundId: rid,
    finalStatus: "",
    openedReveal: false,
    revealed: [],
    skipped: [],
  };

  let round = await sdk.getRoundV2(rid);
  log(`round ${rid} v2: status=${round.status.tag} R=${round.reveal_round}`);

  if (round.status.tag === "Open") {
    const state = await readKeeperRevealState(sdk, rid, round);
    const now = Math.floor(Date.now() / 1000);
    if (state && (now > Number(round.reveal_deadline) ||
        (state.policy.tag === "OwnerTriggered" && now < Number(state.policy.values[0])))) {
      log(now > Number(round.reveal_deadline)
        ? `round ${rid}: reveal deadline passed; awaiting void grace`
        : `round ${rid}: awaiting owner opening or fallback ${state.policy.tag === "OwnerTriggered" ? state.policy.values[0] : ""}`);
      result.finalStatus = round.status.tag;
      return result;
    }
    const drandRound = Number(round.reveal_round);
    const available = await waitForRound(deps, drandRound);
    if (!available) {
      result.finalStatus = round.status.tag;
      return result;
    }

    const pollMs = deps.pollMs ?? 3000;
    let signature: Uint8Array | undefined;
    for (let attempt = 0; attempt < 5 && !signature; attempt++) {
      try {
        signature = await fetchRoundSignature(drand, drandRound);
      } catch (error) {
        log(
          `Drand round ${drandRound} not servable yet (try ${attempt + 1}/5): ${errorName(error)}`,
        );
        await sleep(pollMs);
      }
    }
    if (!signature) {
      result.finalStatus = round.status.tag;
      return result;
    }

    try {
      await sdk.openRevealV2(rid, signature);
      result.openedReveal = true;
      log(`open_reveal_v2 OK (round ${rid} via Drand R=${drandRound})`);
    } catch (error) {
      if (!errorMatches(error, IDEMPOTENT_OPEN)) throw error;
      log(`open_reveal_v2 already done (${errorName(error)}); continuing`);
    }
    round = await sdk.getRoundV2(rid);
  }

  if (round.status.tag === "Revealing") {
    const bidders = await sdk.getBiddersV2(rid);
    const opener = deps.openStructuredPayload ?? openPayload;
    log(`revealing ${bidders.length} v2 submission(s)`);

    for (const bidder of bidders) {
      let state;
      try {
        state = await sdk.getSubmissionV2(rid, bidder);
      } catch (error) {
        result.skipped.push({
          bidder,
          reason: `state read failed: ${errorName(error)}`,
        });
        continue;
      }
      if (state.revealed_envelope != null) {
        result.skipped.push({ bidder, reason: "already revealed" });
        continue;
      }

      const seal = await sdk.getSealV2(rid, bidder);
      if (!seal) {
        result.skipped.push({ bidder, reason: "seal expired/absent" });
        continue;
      }

      let envelope: PayloadEnvelope;
      try {
        envelope = await opener(new Uint8Array(seal.ciphertext), drand);
      } catch (error) {
        result.skipped.push({
          bidder,
          reason: `decrypt failed: ${errorName(error)}`,
        });
        continue;
      }

      try {
        await sdk.revealV2({ roundId: rid, bidder, envelope });
        result.revealed.push(bidder);
        log(`revealed v2 submission from ${bidder}`);
      } catch (error) {
        if (errorMatches(error, IDEMPOTENT_REVEAL)) {
          result.skipped.push({ bidder, reason: "already revealed (race)" });
        } else if (errorMatches(error, INVALID_SUBMISSION)) {
          result.skipped.push({ bidder, reason: `invalid or corrupt payload: ${errorName(error)}` });
        } else if (errorMatches(error, ["RevealWindowClosed"])) {
          result.skipped.push({ bidder, reason: "reveal window closed" });
        } else {
          throw error;
        }
      }
    }
    round = await sdk.getRoundV2(rid);
  } else if (round.status.tag !== "Open") {
    log(`round ${rid} v2 is ${round.status.tag}; nothing to reveal`);
  }

  result.finalStatus = round.status.tag;
  return result;
}

export interface CloseResult {
  roundId: bigint;
  cleared: boolean;
  settled: boolean;
  voided: boolean;
  winner?: string;
  finalStatus: string;
  skipped: string[];
}

/** Drive a revealed round to completion: clear (after the reveal deadline) then
 *  settle. Permissionless and idempotent — re-running on an already cleared or
 *  settled round skips rather than erroring. */
export async function closeRound(
  deps: KeeperDeps,
  roundId: bigint | number,
): Promise<CloseResult> {
  const { sdk, log = () => {} } = deps;
  const rid = BigInt(roundId);
  const result: CloseResult = {
    roundId: rid,
    cleared: false,
    settled: false,
    voided: false,
    winner: undefined,
    finalStatus: "",
    skipped: [],
  };

  let round = await sdk.getRound(rid);
  log(`round ${rid}: status=${round.status.tag} (close)`);

  // ── Phase C: clear once the reveal window has closed ──────────────────
  if (round.status.tag === "Revealing") {
    const now = Math.floor(Date.now() / 1000);
    if (now <= Number(round.reveal_deadline)) {
      result.skipped.push(`reveal window open until ${round.reveal_deadline}`);
      result.finalStatus = round.status.tag;
      return result;
    }
    try {
      const winner = await sdk.clear(rid);
      result.cleared = true;
      result.winner = winner;
      if (winner === undefined) {
        result.voided = true;
        log(`cleared → no valid bids; round voided + refunded`);
      } else {
        log(`cleared → winner ${winner}`);
      }
    } catch (e) {
      if (errorMatches(e, ["AlreadyCleared", "RevealStillOpen", "WrongStatus", "RoundVoided"])) {
        result.skipped.push(`clear skipped: ${errorName(e)}`);
      } else {
        throw e;
      }
    }
    round = await sdk.getRound(rid);
  }

  // ── Phase D: settle a cleared round (real SAC transfers) ──────────────
  if (round.status.tag === "Cleared") {
    try {
      result.settled = await submitSettlement(deps, rid, () => sdk.settle(rid));
      if (result.settled) log(`settled round ${rid}`);
      else result.skipped.push("settlement already submitted or terminal");
    } catch (e) {
      if (errorMatches(e, ["AlreadySettled", "NotCleared", "WrongStatus"])) {
        result.skipped.push(`settle skipped: ${errorName(e)}`);
      } else {
        throw e;
      }
    }
    round = await sdk.getRound(rid);
  } else if (round.status.tag === "Settled") {
    result.skipped.push("already settled");
  } else if (round.status.tag === "Voided") {
    result.skipped.push("voided (escrow refunded at clear)");
  }

  if (result.winner === undefined && round.winner != null) {
    result.winner = round.winner;
  }
  result.finalStatus = round.status.tag;
  return result;
}

/** Finalize a Core v2 round. ReceiptOnly rounds complete during clearV2;
 * Auction rounds continue through escrow settlement. */
export async function closeRoundV2(
  deps: KeeperDeps,
  roundId: bigint | number,
): Promise<CloseResult> {
  const { sdk, log = () => {} } = deps;
  const rid = BigInt(roundId);
  const result: CloseResult = {
    roundId: rid,
    cleared: false,
    settled: false,
    voided: false,
    winner: undefined,
    finalStatus: "",
    skipped: [],
  };

  let round = await sdk.getRoundV2(rid);
  if (round.status.tag === "Revealing") {
    const now = Math.floor(Date.now() / 1000);
    if (now <= Number(round.reveal_deadline)) {
      result.skipped.push(`reveal window open until ${round.reveal_deadline}`);
      result.finalStatus = round.status.tag;
      return result;
    }
    try {
      result.winner = await sdk.clearV2(rid);
      result.cleared = true;
      log(`cleared v2 round ${rid}`);
    } catch (error) {
      if (
        errorMatches(error, [
          "AlreadyCleared",
          "AlreadySettled",
          "RevealStillOpen",
          "WrongStatus",
          "RoundVoided",
        ])
      ) {
        result.skipped.push(`clear_v2 skipped: ${errorName(error)}`);
      } else {
        throw error;
      }
    }
    round = await sdk.getRoundV2(rid);
  }

  if (round.status.tag === "Cleared") {
    try {
      result.settled = await submitSettlement(deps, rid, () => sdk.settleV2(rid));
      if (result.settled) log(`settled v2 auction ${rid}`);
      else result.skipped.push("settlement already submitted or terminal");
    } catch (error) {
      if (errorMatches(error, ["AlreadySettled", "NotCleared", "WrongStatus"])) {
        result.skipped.push(`settle_v2 skipped: ${errorName(error)}`);
      } else {
        throw error;
      }
    }
    round = await sdk.getRoundV2(rid);
  } else if (round.status.tag === "Settled") {
    if (round.mode.tag === "ReceiptOnly" && result.cleared) {
      result.settled = true;
    } else {
      result.skipped.push("already settled");
    }
  } else if (round.status.tag === "Voided") {
    result.voided = true;
    result.skipped.push("voided (escrow refunded at clear)");
  }

  if (result.winner === undefined && round.winner != null) {
    result.winner = round.winner;
  }
  result.finalStatus = round.status.tag;
  return result;
}

/** Matches `VOID_GRACE` in the Round contract (seconds after reveal_deadline). */
export const VOID_GRACE_SECONDS = 3600;

export interface VoidResult {
  roundId: bigint;
  voided: boolean;
  skipped: string[];
  finalStatus: string;
}

/** Liveness safety valve: void an Open round if R never arrived and grace elapsed. */
export async function voidIfStale(
  deps: KeeperDeps,
  roundId: bigint | number,
): Promise<VoidResult> {
  const { sdk, log = () => {} } = deps;
  const rid = BigInt(roundId);
  const result: VoidResult = {
    roundId: rid,
    voided: false,
    skipped: [],
    finalStatus: "",
  };

  let round = await readKeeperRound(sdk, rid, deps.protocolVersion ?? 1);
  if (round.status.tag !== "Open") {
    result.skipped.push(`status ${round.status.tag}`);
    result.finalStatus = round.status.tag;
    return result;
  }

  const now = Math.floor(Date.now() / 1000);
  const voidAfter = Number(round.reveal_deadline) + VOID_GRACE_SECONDS;
  if (now <= voidAfter) {
    result.skipped.push(`void not yet allowed until ${voidAfter}`);
    result.finalStatus = round.status.tag;
    return result;
  }

  try {
    if (deps.protocolVersion === 2) await sdk.voidV2(rid);
    else await sdk.void(rid);
    result.voided = true;
    log(`voided round ${rid} (Drand liveness / grace elapsed)`);
  } catch (e) {
    if (errorMatches(e, ["NotVoidable", "WrongStatus", "AlreadyCleared", "AlreadySettled", "RoundVoided"])) {
      result.skipped.push(errorName(e));
    } else {
      throw e;
    }
  }
  round = await readKeeperRound(sdk, rid, deps.protocolVersion ?? 1);
  result.finalStatus = round.status.tag;
  return result;
}

/** Parse `1,2,5` or `1-5` into round ids. */
export function parseRoundIdSpec(spec: string): bigint[] {
  const ids = new Set<bigint>();
  for (const part of spec.split(",").map((s) => s.trim()).filter(Boolean)) {
    if (part.includes("-")) {
      const [a, b] = part.split("-", 2).map((s) => BigInt(s.trim()));
      for (let i = a; i <= b; i++) ids.add(i);
    } else {
      ids.add(BigInt(part));
    }
  }
  return [...ids].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
}

export async function discoverRoundIds(
  reader: Pick<SubRosaClient, "getRound"> & Partial<Pick<SubRosaClient, "getRoundV2">>,
  opts: { from?: bigint; maxProbe?: number; protocolVersion?: KeeperProtocolVersion } = {},
): Promise<bigint[]> {
  const from = opts.from ?? 1n;
  const maxProbe = opts.maxProbe ?? 64;
  const ids: bigint[] = [];
  for (let i = 0n; i < BigInt(maxProbe); i++) {
    const id = from + i;
    try {
      await readKeeperRound(reader, id, opts.protocolVersion ?? 1);
      ids.push(id);
    } catch (e) {
      // v1 and v2 share a counter but have separate storage: missing IDs can be gaps.
      if (errorMatches(e, ["RoundNotFound"])) continue;
      throw e;
    }
  }
  return ids;
}

export interface WatchTickResult {
  roundId: bigint;
  keep?: KeeperResult;
  close?: CloseResult;
  void?: VoidResult;
  finalStatus: string;
}

/** One non-blocking watch pass: void-if-stale → keep → close. */
export async function watchRound(
  deps: KeeperDeps,
  roundId: bigint | number,
): Promise<WatchTickResult> {
  const rid = BigInt(roundId);
  const tick: WatchTickResult = { roundId: rid, finalStatus: "" };

  const voidRes = await voidIfStale(deps, rid);
  if (voidRes.voided) tick.void = voidRes;

  let round = await readKeeperRound(deps.sdk, rid, deps.protocolVersion ?? 1);
  if (round.status.tag === "Open" || round.status.tag === "Revealing") {
    tick.keep = await (deps.protocolVersion === 2 ? keepRoundV2 : keepRound)(
      { ...deps, maxWaitSeconds: 0 },
      rid,
    );
    round = await readKeeperRound(deps.sdk, rid, deps.protocolVersion ?? 1);
  }

  if (
    round.status.tag === "Revealing" ||
    round.status.tag === "Cleared"
  ) {
    tick.close = await (deps.protocolVersion === 2 ? closeRoundV2 : closeRound)(deps, rid);
    round = await readKeeperRound(deps.sdk, rid, deps.protocolVersion ?? 1);
  }

  tick.finalStatus = round.status.tag;
  if (round.status.tag === "Settled" || round.status.tag === "Voided") {
    deps.settlementGuard?.markTerminal(rid, `${round.status.tag} on-chain`);
  }
  return tick;
}
