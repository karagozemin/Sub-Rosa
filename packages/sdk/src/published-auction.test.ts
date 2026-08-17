import assert from "node:assert/strict";
import { test } from "node:test";

import { sha256 } from "@noble/hashes/sha2.js";
import { StrKey } from "@stellar/stellar-sdk";
import { encodePayloadEnvelope } from "@sub-rosa/tlock";

import { networkFingerprint } from "./receipt.js";
import type { CoreV2Receipt } from "./receipt-v2.js";
import {
  parsePublishedAuctionEvidence,
  serializePublishedAuctionEvidence,
  verifyPublishedAuctionEvidence,
  type PublishedAuctionEvidence,
} from "./published-auction.js";

const TESTNET = "Test SDF Network ; September 2015";
const contractId = StrKey.encodeContract(Buffer.alloc(32, 9));
const address = (fill: number) => StrKey.encodeEd25519PublicKey(Buffer.alloc(32, fill));
const txHash = (fill: string) => fill.repeat(64);

function receipt(): CoreV2Receipt {
  const bidders = [address(1), address(2), address(3)];
  const amounts = [700n, 500n, 600n];
  const submissions = Object.fromEntries(bidders.map((bidder, index) => {
    const envelope = encodePayloadEnvelope({
      amount: amounts[index],
      nonce: new Uint8Array(32).fill(index + 1),
      payload: new Uint8Array(),
    });
    return [bidder, {
      commitment: Buffer.from(sha256(envelope)).toString("hex"),
      escrow: "1000",
      revealedEnvelope: Buffer.from(envelope).toString("hex"),
      revealedAmount: amounts[index]!.toString(),
      valid: true,
      settled: true,
      evidence: { ciphertext: null, auditorBlob: null },
    }];
  }));
  return {
    version: 2,
    protocolVersion: 2,
    network: TESTNET,
    networkFingerprint: networkFingerprint(TESTNET),
    contractId,
    exportedAt: "2026-08-17T00:00:00.000Z",
    roundId: "21",
    itemRef: "11".repeat(32),
    schemaRef: "22".repeat(32),
    mode: "Auction",
    paymentAsset: StrKey.encodeContract(Buffer.alloc(32, 3)),
    lotAsset: StrKey.encodeContract(Buffer.alloc(32, 4)),
    lotAmount: "10000000",
    revealRound: 12345,
    drandGenesis: "1692803367",
    drandPeriod: "3",
    clearingRule: "HighestBid",
    commitDeadline: "1000",
    revealDeadline: "2000",
    operator: address(4),
    auditorPubkey: "33".repeat(32),
    maxParticipants: 5,
    policy: {
      enforced: true,
      fixedEscrow: "1000",
      participation: "Allowlist",
      eligibleParticipants: bidders,
    },
    bidders,
    submissions,
    winner: bidders[0]!,
    winningAmount: "700",
    status: "Settled",
  };
}

function evidence(): PublishedAuctionEvidence {
  const canonical = receipt();
  return {
    version: 1,
    schema: "sub-rosa/published-auction-evidence/v1",
    slug: "instawards-round-1",
    title: "Instawards sealed auction round 1",
    network: "testnet",
    generatedAt: "2026-08-17T00:00:00.000Z",
    contractId: canonical.contractId,
    roundId: canonical.roundId,
    receipt: canonical,
    transactions: [
      { phase: "create_round", hash: txHash("1"), actor: canonical.operator },
      { phase: "commit", hash: txHash("2"), actor: canonical.bidders[0]! },
      { phase: "open_reveal", hash: txHash("3"), actor: canonical.operator },
      { phase: "reveal", hash: txHash("4"), actor: canonical.operator },
      { phase: "clear", hash: txHash("5"), actor: canonical.operator },
      { phase: "settle_and_refund", hash: txHash("6"), actor: canonical.operator },
    ],
    settlement: {
      transactionHash: txHash("6"),
      refundTransactionHash: txHash("6"),
      atomic: true,
      effects: ["winning payment to seller", "loser escrow refunds"],
    },
  };
}

test("verifies published evidence with a canonical receipt and atomic settlement hash", () => {
  const published = evidence();
  const verification = verifyPublishedAuctionEvidence(published, { minimumBidders: 3 });
  assert.equal(verification.valid, true, JSON.stringify(verification.issues));
  assert.deepEqual(
    parsePublishedAuctionEvidence(serializePublishedAuctionEvidence(published)),
    published,
  );
});

test("rejects mismatched receipts, too few bidders, and split refund claims", () => {
  const published = evidence();
  published.roundId = "22";
  published.receipt.bidders = published.receipt.bidders.slice(0, 2);
  published.settlement.refundTransactionHash = txHash("7");
  const verification = verifyPublishedAuctionEvidence(published, { minimumBidders: 3 });
  assert.equal(verification.valid, false);
  assert.ok(verification.issues.some((issue) => issue.code === "round_mismatch"));
  assert.ok(verification.issues.some((issue) => issue.code === "insufficient_bidders"));
  assert.ok(verification.issues.some((issue) => issue.code === "non_atomic_refund_hash"));
});
