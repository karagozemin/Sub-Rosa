import {
  verifyReceiptV2,
  type CoreV2Receipt,
} from "./receipt-v2.js";
import type { SubRosaNetwork } from "./deployments.js";

export const PUBLISHED_AUCTION_EVIDENCE_VERSION = 1;

export type AuctionEvidencePhase =
  | "create_round"
  | "commit"
  | "open_reveal"
  | "reveal"
  | "clear"
  | "settle_and_refund";

export interface AuctionEvidenceTransaction {
  phase: AuctionEvidencePhase;
  hash: string;
  actor: string;
  note?: string;
}

export interface PublishedAuctionEvidence {
  version: typeof PUBLISHED_AUCTION_EVIDENCE_VERSION;
  schema: "sub-rosa/published-auction-evidence/v1";
  slug: string;
  title: string;
  network: SubRosaNetwork;
  generatedAt: string;
  contractId: string;
  roundId: string;
  receipt: CoreV2Receipt;
  transactions: AuctionEvidenceTransaction[];
  settlement: {
    transactionHash: string;
    refundTransactionHash: string;
    atomic: true;
    effects: string[];
  };
}

export interface PublishedAuctionEvidenceIssue {
  code: string;
  message: string;
}

export interface PublishedAuctionEvidenceVerification {
  valid: boolean;
  issues: PublishedAuctionEvidenceIssue[];
  receiptValid: boolean;
}

const transactionHashPattern = /^[0-9a-f]{64}$/i;

export function serializePublishedAuctionEvidence(
  evidence: PublishedAuctionEvidence,
): string {
  return `${JSON.stringify(evidence, null, 2)}\n`;
}

export function parsePublishedAuctionEvidence(
  source: string,
): PublishedAuctionEvidence {
  return JSON.parse(source) as PublishedAuctionEvidence;
}

export function verifyPublishedAuctionEvidence(
  evidence: PublishedAuctionEvidence,
  options: { minimumBidders?: number } = {},
): PublishedAuctionEvidenceVerification {
  const issues: PublishedAuctionEvidenceIssue[] = [];
  const add = (code: string, message: string) => issues.push({ code, message });
  const receiptVerification = verifyReceiptV2(evidence.receipt);
  const minimumBidders = options.minimumBidders ?? 1;

  if (
    evidence.version !== PUBLISHED_AUCTION_EVIDENCE_VERSION ||
    evidence.schema !== "sub-rosa/published-auction-evidence/v1"
  ) {
    add("unsupported_version", "published auction evidence version is unsupported");
  }
  if (!evidence.slug || !/^[a-z0-9-]+$/.test(evidence.slug)) {
    add("invalid_slug", "evidence slug must use lowercase letters, numbers, and hyphens");
  }
  if (evidence.network !== "testnet" && evidence.network !== "mainnet") {
    add("invalid_network", "evidence network must be testnet or mainnet");
  }
  if (evidence.contractId !== evidence.receipt.contractId) {
    add("contract_mismatch", "evidence and canonical receipt contract IDs differ");
  }
  if (evidence.roundId !== evidence.receipt.roundId) {
    add("round_mismatch", "evidence and canonical receipt round IDs differ");
  }
  if (evidence.receipt.mode !== "Auction") {
    add("not_auction", "published auction evidence requires an Auction receipt");
  }
  if (evidence.receipt.status !== "Settled") {
    add("not_settled", "published auction evidence requires a Settled receipt");
  }
  if (evidence.receipt.bidders.length < minimumBidders) {
    add(
      "insufficient_bidders",
      `receipt has ${evidence.receipt.bidders.length} bidders; ${minimumBidders} required`,
    );
  }
  if (!receiptVerification.valid) {
    add(
      "invalid_receipt",
      `canonical receipt failed verification: ${receiptVerification.issues
        .filter((issue) => issue.severity === "error")
        .map((issue) => issue.code)
        .join(", ")}`,
    );
  }

  const transactionHashes = new Set<string>();
  for (const transaction of evidence.transactions) {
    if (!transactionHashPattern.test(transaction.hash)) {
      add("invalid_transaction_hash", `${transaction.phase} has an invalid transaction hash`);
    }
    transactionHashes.add(transaction.hash.toLowerCase());
  }
  if (!evidence.transactions.some((transaction) => transaction.phase === "create_round")) {
    add("missing_create", "round creation transaction is missing");
  }
  if (!evidence.transactions.some((transaction) => transaction.phase === "commit")) {
    add("missing_commit", "commit transactions are missing");
  }
  if (!evidence.transactions.some((transaction) => transaction.phase === "open_reveal")) {
    add("missing_open_reveal", "open reveal transaction is missing");
  }
  if (!evidence.transactions.some((transaction) => transaction.phase === "reveal")) {
    add("missing_reveal", "reveal transactions are missing");
  }
  if (!evidence.transactions.some((transaction) => transaction.phase === "clear")) {
    add("missing_clear", "clear transaction is missing");
  }
  if (!transactionHashPattern.test(evidence.settlement.transactionHash)) {
    add("invalid_settlement_hash", "settlement transaction hash is invalid");
  }
  if (evidence.settlement.refundTransactionHash !== evidence.settlement.transactionHash) {
    add(
      "non_atomic_refund_hash",
      "Core v2 Auction settlement and refunds must reference the same atomic transaction",
    );
  }
  if (!transactionHashes.has(evidence.settlement.transactionHash.toLowerCase())) {
    add("missing_settlement_transaction", "settlement hash is absent from transaction evidence");
  }
  if (
    !evidence.transactions.some(
      (transaction) =>
        transaction.phase === "settle_and_refund" &&
        transaction.hash.toLowerCase() === evidence.settlement.transactionHash.toLowerCase(),
    )
  ) {
    add("missing_atomic_phase", "settle_and_refund transaction phase is missing");
  }

  return {
    valid: issues.length === 0,
    issues,
    receiptValid: receiptVerification.valid,
  };
}
