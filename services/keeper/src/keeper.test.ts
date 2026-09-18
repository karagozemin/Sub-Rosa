import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  closeRoundV2,
  errorMatches,
  errorName,
  keepRoundV2,
  waitForRound,
} from "./index.js";

test("errorMatches detects idempotent contract error codes in any shape", () => {
  assert.equal(errorMatches(new Error("RevealAlreadyOpen"), ["RevealAlreadyOpen"]), true);
  assert.equal(errorMatches(new Error("HostError: ... AlreadyRevealed(32)"), ["AlreadyRevealed"]), true);
  assert.equal(errorMatches({ message: "HashMismatch" }, ["HashMismatch"]), true);
  assert.equal(errorMatches({ error: { code: "RevealWindowClosed" } }, ["RevealWindowClosed"]), true);
  assert.equal(errorMatches(new Error("InvalidDrandSignature"), ["AlreadyRevealed"]), false);
});

test("errorName extracts a readable message", () => {
  assert.equal(errorName(new Error("boom")), "boom");
  assert.equal(errorName({ message: "x" }), JSON.stringify({ message: "x" }));
});

test("errorMatches handles SDK cause chains and numeric Soroban errors without matching host errors", () => {
  const wrapped = new Error("direct RPC submission failed", { cause: new Error("Error(Contract, #35)") });
  assert.equal(errorMatches(wrapped, ["BidExceedsEscrow"]), true);
  assert.equal(errorMatches(new Error("Error(Storage, #35)"), ["BidExceedsEscrow"]), false);
  const cyclic = new Error("unknown") as Error & { cause?: unknown };
  cyclic.cause = cyclic;
  assert.equal(errorMatches(cyclic, ["BidExceedsEscrow"]), false);
});

test("waitForRound returns false for a future round when not allowed to wait", async () => {
  // A stub Drand client whose chain info puts round R far in the future.
  const nowS = Math.floor(Date.now() / 1000);
  const fakeDrand = {
    chain: () => ({
      info: async () => ({ genesis_time: nowS, period: 3 }),
    }),
  } as never;

  const ok = await waitForRound(
    { sdk: {} as never, drand: fakeDrand, maxWaitSeconds: 0 },
    1_000_000, // ~ genesis + 3,000,000s in the future
  );
  assert.equal(ok, false);
});

test("waitForRound returns true immediately for an already-published round", async () => {
  const nowS = Math.floor(Date.now() / 1000);
  const fakeDrand = {
    chain: () => ({
      // genesis far in the past so round 1 is long published.
      info: async () => ({ genesis_time: nowS - 10_000, period: 3 }),
    }),
  } as never;

  const ok = await waitForRound(
    { sdk: {} as never, drand: fakeDrand, maxWaitSeconds: 0 },
    1,
  );
  assert.equal(ok, true);
});

test("keepRoundV2 opens and reveals complete structured payloads", async () => {
  const envelope = {
    amount: 700n,
    nonce: new Uint8Array(32).fill(3),
    payload: new TextEncoder().encode("proposal body"),
  };
  const revealed: Array<{ bidder: string; payload: Uint8Array }> = [];
  const round = {
    status: { tag: "Revealing" },
    reveal_round: 42n,
  };
  const sdk = {
    async getRoundV2() {
      return round;
    },
    async getBiddersV2() {
      return ["GNEW", "GDONE"];
    },
    async getSubmissionV2(_roundId: bigint, bidder: string) {
      return {
        revealed_envelope: bidder === "GDONE" ? Buffer.from([1]) : undefined,
      };
    },
    async getSealV2() {
      return { ciphertext: Buffer.from("sealed"), auditor_blob: Buffer.alloc(0) };
    },
    async revealV2(params: { bidder: string; envelope: typeof envelope }) {
      revealed.push({ bidder: params.bidder, payload: params.envelope.payload });
    },
  };

  const result = await keepRoundV2(
    {
      sdk: sdk as never,
      drand: {} as never,
      openStructuredPayload: async () => envelope,
    },
    7n,
  );

  assert.deepEqual(result.revealed, ["GNEW"]);
  assert.deepEqual(result.skipped, [
    { bidder: "GDONE", reason: "already revealed" },
  ]);
  assert.equal(result.finalStatus, "Revealing");
  assert.equal(new TextDecoder().decode(revealed[0]?.payload), "proposal body");
});

test("keepRoundV2 opens with a verified frozen Drand beacon using only v2 methods", async () => {
  // Same real quicknet vector as the Soroban contract's BLS tests.
  const R = 29_155_653;
  const signature = "0f74ee9ea1bc8ab52cc375ec82e70b6fed483a2618e90eeaef5631555733554f8bb3ec7c8563341af525d09b3702cae7181d281dbcb68e4779e93184eea8f879301f980708c26e488b5417f9c257b6b9cee7f9a2d6981fb65b7bcd6bcc15d3ac";
  const drand = {
    options: { disableBeaconVerification: false },
    chain: () => ({ info: async () => ({
      genesis_time: 1692803367, period: 3, schemeID: "bls-unchained-g1-rfc9380",
      public_key: "83cf0f2896adee7eb8b5f01fcad3912212c437e0073e911fb90022d3e760183c8c4b450b6a0a6c3ac6a5776a2d1064510d1fec758c921cc22b0e17e63aaf4bcb5ed66304de9cf809bd274ca73bab4af5a6e9c76a4bc09e76eae8991ef5ece45a",
    }) }),
    get: async (round: number) => ({ round, signature, randomness: createHash("sha256").update(Buffer.from(signature, "hex")).digest("hex") }),
  };
  let status = "Open";
  const result = await keepRoundV2({
    drand: drand as never,
    sdk: {
      getRoundV2: async () => ({ status: { tag: status }, reveal_round: BigInt(R) }),
      openRevealV2: async (id: bigint, sig: Uint8Array) => {
        assert.equal(id, 7n);
        assert.equal(Buffer.from(sig).toString("hex"), signature);
        status = "Revealing";
      },
      getBiddersV2: async () => [],
    } as never,
  }, 7n);
  assert.equal(result.openedReveal, true);
  assert.equal(result.finalStatus, "Revealing");
});

test("closeRoundV2 finalizes ReceiptOnly without calling settlement", async () => {
  let status = "Revealing";
  let settleCalls = 0;
  const sdk = {
    async getRoundV2() {
      return {
        status: { tag: status },
        mode: { tag: "ReceiptOnly" },
        reveal_deadline: 0n,
        winner: undefined,
      };
    },
    async clearV2() {
      status = "Settled";
      return undefined;
    },
    async settleV2() {
      settleCalls += 1;
    },
  };

  const result = await closeRoundV2(
    { sdk: sdk as never, drand: {} as never },
    8n,
  );

  assert.equal(result.cleared, true);
  assert.equal(result.settled, true);
  assert.equal(result.finalStatus, "Settled");
  assert.equal(settleCalls, 0);
});

for (const rejection of ["BidExceedsEscrow", "InvalidAmount", "MalformedPayload", "HashMismatch", "UnsupportedVersion", "EscrowNotAllowed"]) {
  test(`keepRoundV2 continues after ${rejection} and retries only unfinished submissions`, async () => {
    const revealed = new Set<string>();
    const attempts: string[] = [];
    const sdk = {
      async getRoundV2() { return { status: { tag: "Revealing" } }; },
      async getBiddersV2() { return ["bad", "good"]; },
      async getSubmissionV2(_id: bigint, bidder: string) {
        return { revealed_envelope: revealed.has(bidder) ? Buffer.from([1]) : undefined };
      },
      async getSealV2() { return { ciphertext: Buffer.from([1]) }; },
      async revealV2({ bidder }: { bidder: string }) {
        attempts.push(bidder);
        if (bidder === "bad") throw new Error("direct RPC submission failed", { cause: new Error(rejection) });
        revealed.add(bidder);
      },
    };
    const deps = {
      sdk: sdk as never, drand: {} as never,
      openStructuredPayload: async () => ({ amount: 101n, nonce: new Uint8Array(32), payload: new Uint8Array() }),
    };
    const first = await keepRoundV2(deps, 1n);
    assert.deepEqual(first.revealed, ["good"]);
    assert.match(first.skipped[0].reason, /invalid or corrupt payload/);
    await keepRoundV2(deps, 1n);
    assert.deepEqual(attempts, ["bad", "good", "bad"]);
  });
}

test("keepRoundV2 propagates unexpected submission failures instead of treating them as invalid bids", async () => {
  await assert.rejects(keepRoundV2({
    sdk: {
      getRoundV2: async () => ({ status: { tag: "Revealing" } }),
      getBiddersV2: async () => ["bidder"],
      getSubmissionV2: async () => ({}),
      getSealV2: async () => ({ ciphertext: Buffer.from([1]) }),
      revealV2: async () => { throw new Error("RPC connection lost"); },
    } as never,
    drand: {} as never,
    openStructuredPayload: async () => ({ nonce: new Uint8Array(32), payload: new Uint8Array() }),
  }, 1n), /RPC connection lost/);
});
