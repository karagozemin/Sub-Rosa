import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RoundV2, SubmissionStateV2, SubRosaClient } from "@sub-rosa/sdk";
import { buildKeeperDryRunSummary, parseKeeperRunConfig } from "./dry-run.js";
import { discoverRoundIds, watchRound } from "./keeper.js";
import { buildRoundStatus } from "./status.js";
import { parseKeeperProtocolVersion } from "./protocol.js";
import { runWatchLoop } from "./watch-loop.js";
import { KeeperStore } from "./store.js";
import { createSettlementGuard } from "./settlement-guard.js";

function fixture(mode: "Auction" | "ReceiptOnly", initial: RoundV2["status"]["tag"]) {
  const calls: string[] = [];
  const round: RoundV2 = {
    auditor_pubkey: Buffer.alloc(0),
    clearing_rule: { tag: "HighestBid", values: undefined },
    item_ref: Buffer.alloc(32),
    schema_ref: Buffer.alloc(32),
    operator: "operator",
    payment_asset: undefined,
    lot_asset: undefined,
    lot_amount: 0n,
    max_participants: 25,
    protocol_version: 2,
    mode: { tag: mode, values: undefined },
    status: { tag: initial, values: undefined },
    reveal_round: 1n,
    commit_deadline: 0n,
    reveal_deadline: 0n,
    bidders: [],
    winner: undefined,
    winning_bid: 0n,
  };
  const sdk = {
    async getRound() { throw new Error("unexpected legacy read"); },
    async getBidState() { throw new Error("unexpected legacy state read"); },
    async getRoundV2() { return round; },
    async getBiddersV2() { return round.bidders; },
    async getSubmissionV2(_id: bigint, bidder: string) {
      return {
        // ReceiptOnly can have a revealed envelope without an economic amount.
        revealed_envelope: bidder === "revealed" ? Buffer.from([1]) : undefined,
        revealed_amount: undefined,
      } as SubmissionStateV2;
    },
    async clearV2() {
      calls.push("clearV2");
      round.status.tag = mode === "Auction" ? "Cleared" : "Settled";
      return mode === "Auction" ? "winner" : undefined;
    },
    async settleV2() { calls.push("settleV2"); round.status.tag = "Settled"; },
    async voidV2() { calls.push("voidV2"); round.status.tag = "Voided"; },
  };
  const drand = { chain: () => ({ info: async () => ({ genesis_time: 0, period: 3 }) }) } as never;
  return { sdk, round, calls, drand };
}

test("CLI defaults to Core v2 and requires an explicit valid legacy selection", () => {
  assert.equal(parseKeeperProtocolVersion({}), 2);
  assert.equal(parseKeeperProtocolVersion({ KEEPER_PROTOCOL_VERSION: "1" }), 1);
  assert.throws(() => parseKeeperProtocolVersion({ KEEPER_PROTOCOL_VERSION: "3" }), /must be 1 or 2/);
  assert.equal(parseKeeperRunConfig({ STELLAR_NETWORK: "testnet", KEEPER_DRY_RUN: "true" }).protocolVersion, 2);
});

for (const mode of ["Auction", "ReceiptOnly"] as const) {
  test(`watchRound drives v2 ${mode} to completion and is idempotent`, async () => {
    const { sdk, calls, drand } = fixture(mode, "Revealing");
    const deps = { sdk: sdk as unknown as SubRosaClient, drand, protocolVersion: 2 as const };
    const first = await watchRound(deps, 2n);
    assert.equal(first.finalStatus, "Settled");
    assert.deepEqual(calls, mode === "Auction" ? ["clearV2", "settleV2"] : ["clearV2"]);
    const second = await watchRound(deps, 2n);
    assert.equal(second.finalStatus, "Settled");
    assert.deepEqual(calls, mode === "Auction" ? ["clearV2", "settleV2"] : ["clearV2"]);
  });
}

test("watchRound voids stale Core v2 rounds without attempting Drand or legacy writes", async () => {
  const { sdk, calls, drand } = fixture("Auction", "Open");
  const result = await watchRound({ sdk: sdk as unknown as SubRosaClient, drand, protocolVersion: 2 }, 3n);
  assert.equal(result.finalStatus, "Voided");
  assert.deepEqual(calls, ["voidV2"]);
});

test("Core v2 discovery scans gaps in the shared round counter without legacy fallback", async () => {
  const { sdk, round } = fixture("ReceiptOnly", "Open");
  const probed: bigint[] = [];
  sdk.getRoundV2 = async (...args: unknown[]) => {
    const id = args[0] as bigint;
    probed.push(id);
    if (id === 2n || id === 4n) return round;
    throw new Error("RoundNotFound");
  };
  assert.deepEqual(await discoverRoundIds(sdk, { protocolVersion: 2, maxProbe: 5 }), [2n, 4n]);
  assert.deepEqual(probed, [1n, 2n, 3n, 4n, 5n]);
  sdk.getRoundV2 = async () => { throw new Error("RPC unavailable"); };
  await assert.rejects(discoverRoundIds(sdk, { protocolVersion: 2 }), /RPC unavailable/);
});

test("dry-run and status count v2 proposal envelopes even when amount is absent", async () => {
  const { sdk, round, drand, calls } = fixture("ReceiptOnly", "Revealing");
  round.bidders = ["revealed", "pending"];
  round.reveal_deadline = 1000n;
  const summary = await buildKeeperDryRunSummary(sdk, 1n, 500, 2);
  const status = await buildRoundStatus({ reader: sdk, drand, roundId: 1n, nowSeconds: 500, protocolVersion: 2 });
  assert.equal(summary.revealedCount, 1);
  assert.equal(summary.currentPhase, "revealing");
  assert.equal(status.revealedCount, 1);
  assert.equal(status.status, "Revealing");
  assert.deepEqual(calls, []);
});

test("real watch loop persists v2 completion discovered after a missing ID", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "sub-rosa-v2-watch-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const envNames = ["WATCH_FROM", "WATCH_MAX_ROUNDS", "WATCH_ROUND_IDS", "ROUND_ID"];
  const previous = envNames.map((key) => [key, process.env[key]] as const);
  t.after(() => previous.forEach(([key, value]) => {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }));
  delete process.env.WATCH_ROUND_IDS;
  delete process.env.ROUND_ID;
  process.env.WATCH_FROM = "1";
  process.env.WATCH_MAX_ROUNDS = "2";
  const { sdk, round, calls, drand } = fixture("Auction", "Revealing");
  sdk.getRoundV2 = async (...args: unknown[]) => {
    if (args[0] !== 2n) throw new Error("RoundNotFound");
    return round;
  };
  const store = new KeeperStore(join(dir, "store.json"));
  const settlementGuard = createSettlementGuard();
  let stopping = false;
  await runWatchLoop({
    sdk: sdk as unknown as SubRosaClient, drand, protocolVersion: 2,
    log(message) { if (message.startsWith("[round 2]")) stopping = true; },
    pollMs: 0, contractId: "contract", network: "test", store, settlementGuard,
    isStopping: () => stopping,
  });
  assert.deepEqual(calls, ["clearV2", "settleV2"]);
  assert.equal(store.getRound(2n)?.lastStatus, "Settled");
  assert.equal(settlementGuard.getEntry(2n)?.status, "terminal");
});
