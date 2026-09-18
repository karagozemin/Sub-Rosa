import assert from "node:assert/strict";
import { test } from "node:test";

import { sha256 } from "@noble/hashes/sha2.js";
import { rpc, StrKey } from "@stellar/stellar-sdk";
import { encodePayloadEnvelope } from "@sub-rosa/tlock";

import { SubRosaClient } from "./client.js";
import {
  parseReceiptV2,
  serializeReceiptV2,
  verifyReceiptV2,
  type CoreV2Receipt,
} from "./receipt-v2.js";
import { networkFingerprint } from "./receipt.js";

const TESTNET = "Test SDF Network ; September 2015";
const contractId = StrKey.encodeContract(Buffer.alloc(32, 9));
const address = (fill: number) =>
  StrKey.encodeEd25519PublicKey(Buffer.alloc(32, fill));

function client(): SubRosaClient {
  return new SubRosaClient({
    rpcUrl: "https://soroban-testnet.stellar.org",
    networkPassphrase: TESTNET,
    contractId,
    _server: {
      getNetwork: async () => ({ passphrase: TESTNET, protocolVersion: "23" }),
      getLedgerEntries: async () => ({ entries: [{}], latestLedger: 123 }),
    } as unknown as rpc.Server,
  });
}

function result<T>(value: T) {
  return { result: { unwrap: () => value } } as any;
}

function auctionReceipt(): CoreV2Receipt {
  const alice = address(1);
  const bob = address(2);
  const aliceEnvelope = encodePayloadEnvelope({
    amount: 700n,
    nonce: new Uint8Array(32).fill(1),
    payload: new TextEncoder().encode("alice terms"),
  });
  const bobEnvelope = encodePayloadEnvelope({
    amount: 500n,
    nonce: new Uint8Array(32).fill(2),
    payload: new TextEncoder().encode("bob terms"),
  });
  const submission = (bytes: Uint8Array, amount: string) => ({
    commitment: Buffer.from(sha256(bytes)).toString("hex"),
    escrow: "1000",
    revealedEnvelope: Buffer.from(bytes).toString("hex"),
    revealedAmount: amount,
    valid: true,
    settled: true,
    evidence: { ciphertext: null, auditorBlob: null },
  });

  return {
    version: 2,
    protocolVersion: 2,
    network: TESTNET,
    networkFingerprint: networkFingerprint(TESTNET),
    contractId,
    exportedAt: "2026-07-31T00:00:00.000Z",
    roundId: "5",
    itemRef: "11".repeat(32),
    schemaRef: "22".repeat(32),
    mode: "Auction",
    paymentAsset: StrKey.encodeContract(Buffer.alloc(32, 3)),
    lotAsset: StrKey.encodeContract(Buffer.alloc(32, 4)),
    lotAmount: "1",
    revealRound: 12345,
    drandGenesis: "1692803367",
    drandPeriod: "3",
    clearingRule: "HighestBid",
    commitDeadline: "1000",
    revealDeadline: "2000",
    operator: address(3),
    auditorPubkey: "33".repeat(32),
    maxParticipants: 5,
    policy: {
      enforced: true,
      fixedEscrow: "1000",
      participation: "Open",
      eligibleParticipants: [],
    },
    bidders: [alice, bob],
    submissions: {
      [alice]: submission(aliceEnvelope, "700"),
      [bob]: submission(bobEnvelope, "500"),
    },
    winner: alice,
    winningAmount: "700",
    status: "Settled",
  };
}

test("verifies a canonical Core v2 auction receipt and recomputes its winner", () => {
  const receipt = auctionReceipt();
  const verification = verifyReceiptV2(receipt);
  assert.equal(verification.valid, true, JSON.stringify(verification.issues));
  assert.equal(verification.computedWinner.address, receipt.winner);
  assert.equal(verification.computedWinner.value, 700n);
  assert.deepEqual(parseReceiptV2(serializeReceiptV2(receipt)), receipt);
});

test("rejects envelope tampering and a forged winner", () => {
  const receipt = auctionReceipt();
  const bidder = receipt.bidders[0]!;
  receipt.submissions[bidder]!.revealedEnvelope = `00${receipt.submissions[bidder]!.revealedEnvelope!.slice(2)}`;
  receipt.winner = receipt.bidders[1]!;
  const verification = verifyReceiptV2(receipt);
  assert.equal(verification.valid, false);
  assert.ok(verification.issues.some((issue) => issue.code === "commitment_mismatch"));
  assert.ok(verification.issues.some((issue) => issue.code === "winner_mismatch"));
});

test("exports Core v2 durable state instead of calling the legacy receipt path", async () => {
  const sdk = client();
  const fixture = auctionReceipt();
  const bidder = fixture.bidders[0]!;
  const entry = fixture.submissions[bidder]!;
  const round = {
    protocol_version: 2,
    item_ref: Buffer.from(fixture.itemRef, "hex"),
    schema_ref: Buffer.from(fixture.schemaRef, "hex"),
    mode: { tag: "Auction" },
    payment_asset: fixture.paymentAsset,
    lot_asset: fixture.lotAsset,
    lot_amount: 1n,
    reveal_round: 12345n,
    clearing_rule: { tag: "HighestBid" },
    commit_deadline: 1000n,
    reveal_deadline: 2000n,
    operator: fixture.operator,
    auditor_pubkey: Buffer.from(fixture.auditorPubkey, "hex"),
    max_participants: 5,
    bidders: [bidder],
    winner: bidder,
    winning_bid: 700n,
    status: { tag: "Settled" },
  };
  (sdk.contract as any).get_round_v2 = async () => result(round);
  (sdk.contract as any).get_config = async () => result({
    drand_genesis: 1692803367n,
    drand_period: 3n,
  });
  (sdk.contract as any).get_bidders_v2 = async () => result([bidder]);
  (sdk.contract as any).get_round_policy_v2 = async () => ({
    result: {
      fixed_escrow: 1000n,
      eligible_participants: [],
      settlement: {
        mode: { tag: "Auction" },
        payment_asset: fixture.paymentAsset,
        lot_asset: fixture.lotAsset,
        lot_amount: 1n,
      },
    },
  });
  (sdk.contract as any).get_submission_v2 = async () => result({
    commitment: Buffer.from(entry.commitment, "hex"),
    escrow: 1000n,
    revealed_envelope: Buffer.from(entry.revealedEnvelope!, "hex"),
    revealed_amount: 700n,
    valid: true,
    settled: true,
  });
  (sdk.contract as any).get_seal_v2 = async () => ({ result: undefined });

  const exported = await sdk.exportReceiptV2(5n);
  assert.equal(exported.version, 2);
  assert.equal(exported.mode, "Auction");
  assert.equal(exported.policy.fixedEscrow, "1000");
  assert.equal(exported.submissions[bidder]!.revealedAmount, "700");
  assert.equal(verifyReceiptV2(exported).valid, true);
});

test("rejects fixed escrow and eligibility policy violations", () => {
  const receipt = auctionReceipt();
  const bidder = receipt.bidders[0]!;
  receipt.policy.eligibleParticipants = [receipt.bidders[1]!];
  receipt.policy.participation = "Allowlist";
  receipt.submissions[bidder]!.escrow = "999";

  const verification = verifyReceiptV2(receipt);
  assert.equal(verification.valid, false);
  assert.ok(verification.issues.some((issue) => issue.code === "ineligible_bidder"));
  assert.ok(verification.issues.some((issue) => issue.code === "escrow_policy_mismatch"));
});

test("returns verification errors instead of throwing for malformed collections", () => {
  const missingBidders = { ...auctionReceipt(), bidders: null } as unknown as CoreV2Receipt;
  const missingSubmissions = {
    ...auctionReceipt(),
    submissions: null,
  } as unknown as CoreV2Receipt;

  assert.doesNotThrow(() => verifyReceiptV2(missingBidders));
  assert.equal(verifyReceiptV2(missingBidders).valid, false);
  assert.doesNotThrow(() => verifyReceiptV2(missingSubmissions));
  assert.ok(
    verifyReceiptV2(missingSubmissions).issues.some(
      (issue) => issue.code === "missing_submissions",
    ),
  );
});


function ownerReceipt(): CoreV2Receipt {
  const receipt = auctionReceipt();
  const privacy = BigInt(receipt.drandGenesis) + BigInt(receipt.drandPeriod) * BigInt(receipt.revealRound - 1);
  return { ...receipt, version: 3, protocolVersion: 3,
    commitDeadline: (privacy - 1n).toString(), revealDeadline: (privacy + 360n).toString(),
    revealPolicy: { type: "owner-triggered", controller: receipt.operator, fallbackAt: (privacy + 60n).toString() },
    openedAt: privacy.toString(),
  };
}

test("v3 receipts retain immutable policy and opening time and reject policy tampering", () => {
  const receipt = ownerReceipt();
  assert.equal(verifyReceiptV2(receipt).valid, true);
  assert.deepEqual(parseReceiptV2(serializeReceiptV2(receipt)), receipt);
  const bad: CoreV2Receipt[] = [
    { ...receipt, revealPolicy: undefined },
    { ...receipt, openedAt: null },
    { ...receipt, openedAt: "1" },
    { ...receipt, revealPolicy: { type: "owner-triggered", controller: address(9), fallbackAt: (receipt.revealPolicy as any).fallbackAt } },
    { ...receipt, revealPolicy: { type: "owner-triggered", controller: receipt.operator, fallbackAt: receipt.revealDeadline } },
    { ...receipt, version: 2, protocolVersion: 2 },
  ];
  for (const value of bad) assert.equal(verifyReceiptV2(value).valid, false);
  assert.equal(verifyReceiptV2({ ...receipt, status: "Open", openedAt: null }).issues.some(i => i.code === "invalid_opened_at"), false);
});

test("exporter never labels a v3 record as a legacy receipt or ignores missing policy", async () => {
  const sdk = client();
  const receipt = ownerReceipt();
  sdk.getRoundV2 = async () => ({
    protocol_version: 3, item_ref: Buffer.alloc(32), schema_ref: Buffer.alloc(32), mode: { tag: "ReceiptOnly" },
    lot_amount: 0n, reveal_round: 12345n, clearing_rule: { tag: "HighestBid" },
    commit_deadline: BigInt(receipt.commitDeadline), reveal_deadline: BigInt(receipt.revealDeadline),
    operator: receipt.operator, auditor_pubkey: Buffer.alloc(0), max_participants: 25, bidders: [], winning_bid: 0n, status: { tag: "Open" },
  }) as any;
  sdk.getConfig = async () => ({ drand_genesis: BigInt(receipt.drandGenesis), drand_period: 3n }) as any;
  sdk.getBiddersV2 = async () => [];
  sdk.getRoundPolicyV2 = async () => ({
    settlement: { mode: { tag: "ReceiptOnly", values: undefined }, payment_asset: undefined, lot_asset: undefined, lot_amount: 0n },
    fixed_escrow: 0n, eligible_participants: [],
  });
  sdk.getRevealStateV3 = async () => ({ policy: { tag: "OwnerTriggered", values: [BigInt((receipt.revealPolicy as any).fallbackAt)] }, opened_at: undefined });
  const exported = await sdk.exportReceiptV2(1);
  assert.equal(exported.version, 3);
  assert.equal(exported.protocolVersion, 3);
  assert.deepEqual(exported.revealPolicy, receipt.revealPolicy);
  assert.equal(exported.openedAt, null);
  sdk.getRevealStateV3 = async () => { throw new Error("RevealPolicyMissing"); };
  await assert.rejects(sdk.exportReceiptV2(1), /RevealPolicyMissing/);
  sdk.getRoundPolicyV2 = async () => undefined;
  await assert.rejects(sdk.exportReceiptV2(1), /requires its partner policy/);
});
