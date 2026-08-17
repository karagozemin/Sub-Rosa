import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

import {
  parsePublishedAuctionEvidence,
  verifyPublishedAuctionEvidence,
} from "@sub-rosa/sdk";

const NATIVE_TESTNET_XLM_SAC = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
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
