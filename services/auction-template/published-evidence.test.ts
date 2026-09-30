import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

import {
  parsePublishedAuctionEvidence,
  verifyPublishedAuctionEvidence,
} from "@sub-rosa/sdk";

const NATIVE_TESTNET_XLM_SAC = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
const NATIVE_MAINNET_XLM_SAC = "CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA";
const EVIDENCE_DIRECTORY = resolve(
  import.meta.dirname,
  "../../apps/web/public/instawards/receipts",
);

test("published Instawards set contains three verified native-XLM auctions", () => {
  const roundIds = new Set<string>();
  const settlementHashes = new Set<string>();

  for (let ordinal = 1; ordinal <= 3; ordinal += 1) {
    const evidence = parsePublishedAuctionEvidence(readFileSync(
      resolve(EVIDENCE_DIRECTORY, `instawards-auction-${ordinal}.json`),
      "utf8",
    ));
    const verification = verifyPublishedAuctionEvidence(evidence, { minimumBidders: 3 });

    assert.equal(verification.valid, true, JSON.stringify(verification.issues));
    assert.equal(evidence.network, "testnet");
    assert.equal(evidence.receipt.paymentAsset, NATIVE_TESTNET_XLM_SAC);
    assert.equal(evidence.receipt.bidders.length, 3);
    assert.equal(
      evidence.transactions.filter((transaction) => transaction.phase === "commit").length,
      3,
    );
    assert.equal(
      evidence.transactions.filter((transaction) => transaction.phase === "reveal").length,
      3,
    );
    assert.equal(
      evidence.settlement.refundTransactionHash,
      evidence.settlement.transactionHash,
    );
    roundIds.add(evidence.roundId);
    settlementHashes.add(evidence.settlement.transactionHash);
  }

  assert.equal(roundIds.size, 3, "each receipt must describe a distinct round");
  assert.equal(settlementHashes.size, 3, "each round must have a distinct settlement transaction");
});

test("published Core v2 mainnet capped auction is settled and verified", () => {
  const evidence = parsePublishedAuctionEvidence(readFileSync(
    resolve(EVIDENCE_DIRECTORY, "instawards-mainnet-auction-1.json"),
    "utf8",
  ));
  const verification = verifyPublishedAuctionEvidence(evidence);

  assert.equal(verification.valid, true, JSON.stringify(verification.issues));
  assert.equal(evidence.network, "mainnet");
  assert.equal(evidence.contractId, "CDQOFNCJE5Z4ZZL76DU5652FOUKJVEIZWHFGCZVWH63UYBGPSZIPC325");
  assert.equal(evidence.roundId, "1");
  assert.equal(evidence.receipt.status, "Settled");
  assert.equal(evidence.receipt.paymentAsset, NATIVE_MAINNET_XLM_SAC);
  assert.equal(evidence.receipt.bidders.length, 1);
  assert.equal(evidence.transactions.length, 6);
  assert.equal(
    evidence.settlement.refundTransactionHash,
    evidence.settlement.transactionHash,
  );
});
