import { sha256 } from "@noble/hashes/sha2.js";
import { decodePayloadEnvelope, fromHex, toHex } from "@sub-rosa/tlock";

import { networkFingerprint } from "./receipt.js";
import type { VerificationIssue, VerificationResult } from "./verify.js";

export const CORE_V2_RECEIPT_VERSION = 2;

export interface CoreV2SubmissionReceipt {
  commitment: string;
  escrow: string;
  revealedEnvelope: string | null;
  revealedAmount: string | null;
  valid: boolean;
  settled: boolean;
  evidence: {
    ciphertext: string | null;
    auditorBlob: string | null;
  };
}

export interface CoreV2Receipt {
  version: 2 | 3;
  protocolVersion: 2 | 3;
  /** Required in v3; absent in legacy v2 receipts. Not a proof of authorization. */
  revealPolicy?: { type: "timed" } | { type: "owner-triggered"; controller: string; fallbackAt: string };
  openedAt?: string | null;
  network: string;
  networkFingerprint: string;
  contractId: string;
  exportedAt: string;
  roundId: string;
  itemRef: string;
  schemaRef: string;
  mode: "Auction" | "ReceiptOnly";
  paymentAsset: string | null;
  lotAsset: string | null;
  lotAmount: string;
  revealRound: number;
  drandGenesis: string;
  drandPeriod: string;
  clearingRule: "HighestBid" | "LowestBid";
  commitDeadline: string;
  revealDeadline: string;
  operator: string;
  auditorPubkey: string;
  maxParticipants: number;
  policy: {
    /** False only for legacy Core v2 rounds created before partner policies existed. */
    enforced: boolean;
    fixedEscrow: string | null;
    participation: "Open" | "Allowlist";
    eligibleParticipants: string[];
  };
  bidders: string[];
  submissions: Record<string, CoreV2SubmissionReceipt>;
  winner: string | null;
  winningAmount: string;
  status: "Open" | "Revealing" | "Cleared" | "Settled" | "Voided";
}

function sortKeys(_: string, value: unknown): unknown {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return Object.fromEntries(
      Object.entries(value).sort(([left], [right]) =>
        left < right ? -1 : left > right ? 1 : 0,
      ),
    );
  }
  return value;
}

export function serializeReceiptV2(receipt: CoreV2Receipt): string {
  return `${JSON.stringify(receipt, sortKeys)}\n`;
}

export function parseReceiptV2(json: string): CoreV2Receipt {
  return JSON.parse(json) as CoreV2Receipt;
}

function decimal(value: unknown): bigint | null {
  if (typeof value !== "string" || !/^-?\d+$/.test(value)) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

function isHex(value: unknown, bytes?: number): value is string {
  if (typeof value !== "string" || !/^[0-9a-f]*$/i.test(value)) return false;
  if (value.length % 2 !== 0) return false;
  return bytes === undefined || value.length === bytes * 2;
}

export function verifyReceiptV2(receipt: CoreV2Receipt): VerificationResult {
  const issues: VerificationIssue[] = [];
  const add = (
    severity: VerificationIssue["severity"],
    code: string,
    message: string,
    path?: string,
  ) => issues.push({ severity, code, message, ...(path ? { path } : {}) });

  if (![2, 3].includes(receipt.version) || receipt.protocolVersion !== receipt.version) {
    add("error", "unsupported_version", "receipt and protocol versions must match (2 or 3)");
    return { valid: false, issues, computedWinner: { address: null, value: null } };
  }
  if (!receipt.network || receipt.networkFingerprint !== networkFingerprint(receipt.network)) {
    add("error", "network_mismatch", "network fingerprint does not match the passphrase");
  }
  if (typeof receipt.contractId !== "string" || !receipt.contractId.startsWith("C")) {
    add("error", "invalid_contract_id", "contractId must be a Stellar contract address");
  }
  if (decimal(receipt.roundId) === null) add("error", "invalid_round_id", "roundId is invalid");
  if (!isHex(receipt.itemRef, 32)) add("error", "invalid_item_ref", "itemRef must be 32 bytes");
  if (!isHex(receipt.schemaRef, 32)) add("error", "invalid_schema_ref", "schemaRef must be 32 bytes");
  if (!isHex(receipt.auditorPubkey)) add("error", "invalid_auditor_key", "auditorPubkey must be hex");
  if (!Number.isSafeInteger(receipt.revealRound) || receipt.revealRound <= 0) {
    add("error", "invalid_reveal_round", "revealRound must be a positive safe integer");
  }
  if (!Number.isInteger(receipt.maxParticipants) || receipt.maxParticipants < 1 || receipt.maxParticipants > 25) {
    add("error", "invalid_participant_cap", "maxParticipants must be between 1 and 25");
  }

  if (receipt.version === 3) {
    if (receipt.policy?.enforced !== true) {
      add("error", "missing_partner_policy", "v3 requires its contract-enforced partner policy");
    }
    const genesis = decimal(receipt.drandGenesis);
    const period = decimal(receipt.drandPeriod);
    const commit = decimal(receipt.commitDeadline);
    const deadline = decimal(receipt.revealDeadline);
    const privacy = genesis !== null && genesis >= 0n && period !== null && period > 0n && Number.isSafeInteger(receipt.revealRound) && receipt.revealRound > 0
      ? genesis + period * (BigInt(receipt.revealRound) - 1n) : null;
    if (privacy === null || commit === null || deadline === null || commit >= privacy || deadline <= privacy) {
      add("error", "invalid_reveal_timing", "v3 requires commitDeadline < Drand time < revealDeadline");
    }
    const reveal = receipt.revealPolicy;
    if (!reveal || (reveal.type !== "timed" && reveal.type !== "owner-triggered")) {
      add("error", "invalid_reveal_policy", "v3 requires an explicit reveal policy");
    } else if (reveal.type === "owner-triggered") {
      const fallback = decimal(reveal.fallbackAt);
      if (reveal.controller !== receipt.operator || fallback === null || privacy === null || deadline === null || fallback <= privacy || deadline - fallback < 300n) {
        add("error", "invalid_reveal_policy", "controller must be operator; fallback must follow Drand time and leave 300 seconds to reveal");
      }
    }
    const opened = decimal(receipt.openedAt);
    if (receipt.status === "Open" || receipt.status === "Voided") {
      if (receipt.openedAt !== null) add("error", "invalid_opened_at", "unopened/voided round must have null openedAt");
    } else if (opened === null || privacy === null || deadline === null || opened < privacy || opened > deadline) {
      add("error", "invalid_opened_at", "openedAt must lie within the Drand/reveal window");
    }
  } else if (receipt.revealPolicy !== undefined || receipt.openedAt !== undefined) {
    add("error", "unexpected_reveal_policy", "v2 receipts cannot attest v3 opening policy");
  }

  const policy = receipt.policy;
  if (!policy || typeof policy !== "object") {
    add("error", "missing_policy", "receipt must include its partner policy");
  } else {
    const fixedEscrow = policy.fixedEscrow === null
      ? null
      : decimal(policy.fixedEscrow);
    if (policy.enforced && fixedEscrow === null) {
      add("error", "invalid_fixed_escrow", "enforced policy requires fixedEscrow");
    }
    if (!policy.enforced && policy.fixedEscrow !== null) {
      add("error", "legacy_policy_has_escrow", "unenforced legacy policy must use null fixedEscrow");
    }
    if (!Array.isArray(policy.eligibleParticipants)) {
      add("error", "invalid_eligibility", "eligibleParticipants must be an array");
    } else {
      const eligible = new Set(policy.eligibleParticipants);
      if (eligible.size !== policy.eligibleParticipants.length) {
        add("error", "duplicate_eligible_participant", "eligibleParticipants contains duplicates");
      }
      if (policy.eligibleParticipants.length > receipt.maxParticipants) {
        add("error", "eligibility_exceeds_cap", "eligibleParticipants exceeds maxParticipants");
      }
      const expectedParticipation = eligible.size === 0 ? "Open" : "Allowlist";
      if (policy.participation !== expectedParticipation) {
        add("error", "participation_mismatch", "participation does not match eligibleParticipants");
      }
      if (policy.enforced && eligible.size > 0 && Array.isArray(receipt.bidders)) {
        for (const bidder of receipt.bidders) {
          if (!eligible.has(bidder)) {
            add("error", "ineligible_bidder", `${bidder} is not included in the round allowlist`);
          }
        }
      }
    }
    if (policy.enforced && receipt.mode === "Auction" && (fixedEscrow === null || fixedEscrow <= 0n)) {
      add("error", "invalid_fixed_escrow", "Auction policy requires positive fixedEscrow");
    }
    if (policy.enforced && receipt.mode === "ReceiptOnly" && fixedEscrow !== 0n) {
      add("error", "receipt_only_fixed_escrow", "ReceiptOnly policy requires zero fixedEscrow");
    }
    if (!policy.enforced) {
      add("warning", "legacy_policy", "round predates enforced partner policy");
    }
  }

  const lotAmount = decimal(receipt.lotAmount);
  const winningAmount = decimal(receipt.winningAmount);
  if (lotAmount === null || lotAmount < 0n) add("error", "invalid_lot_amount", "lotAmount is invalid");
  if (winningAmount === null || winningAmount < 0n) {
    add("error", "invalid_winning_amount", "winningAmount is invalid");
  }
  if (receipt.mode === "Auction") {
    if (!receipt.paymentAsset || !receipt.lotAsset || lotAmount === null || lotAmount <= 0n) {
      add("error", "invalid_auction_assets", "Auction requires payment asset, lot asset, and positive lot amount");
    }
  } else if (receipt.mode === "ReceiptOnly") {
    if (receipt.paymentAsset !== null || receipt.lotAsset !== null || lotAmount !== 0n) {
      add("error", "receipt_only_has_assets", "ReceiptOnly cannot configure settlement assets");
    }
    if (receipt.winner !== null || winningAmount !== 0n) {
      add("error", "receipt_only_has_winner", "ReceiptOnly cannot declare an economic winner");
    }
  } else {
    add("error", "invalid_mode", `unsupported mode ${String(receipt.mode)}`);
  }

  if (!Array.isArray(receipt.bidders)) {
    add("error", "missing_bidders", "bidders must be an array");
    return { valid: false, issues, computedWinner: { address: null, value: null } };
  }
  if (
    !receipt.submissions ||
    typeof receipt.submissions !== "object" ||
    Array.isArray(receipt.submissions)
  ) {
    add("error", "missing_submissions", "submissions must be an object");
    return { valid: false, issues, computedWinner: { address: null, value: null } };
  }
  const bidderSet = new Set<string>();
  for (const bidder of receipt.bidders) {
    if (bidderSet.has(bidder)) add("error", "duplicate_bidder", `duplicate bidder ${bidder}`);
    bidderSet.add(bidder);
    if (!receipt.submissions[bidder]) add("error", "missing_submission", `missing submission for ${bidder}`);
  }
  for (const bidder of Object.keys(receipt.submissions)) {
    if (!bidderSet.has(bidder)) add("error", "orphan_submission", `submission for unknown bidder ${bidder}`);
  }

  let computedWinner: string | null = null;
  let computedAmount: bigint | null = null;
  for (const bidder of receipt.bidders) {
    const submission = receipt.submissions[bidder];
    if (!submission) continue;
    const prefix = `submissions.${bidder}`;
    if (!isHex(submission.commitment, 32)) {
      add("error", "invalid_commitment", "commitment must be 32 bytes", `${prefix}.commitment`);
    }
    const escrow = decimal(submission.escrow);
    if (escrow === null || escrow < 0n) add("error", "invalid_escrow", "escrow is invalid", `${prefix}.escrow`);
    const stateAmount = submission.revealedAmount === null ? null : decimal(submission.revealedAmount);
    if (submission.revealedAmount !== null && stateAmount === null) {
      add("error", "invalid_revealed_amount", "revealedAmount is invalid", `${prefix}.revealedAmount`);
    }
    const policyEscrow = receipt.policy?.fixedEscrow === null
      ? null
      : decimal(receipt.policy?.fixedEscrow);
    if (
      receipt.policy?.enforced &&
      receipt.mode === "Auction" &&
      escrow !== null &&
      policyEscrow !== null &&
      escrow !== policyEscrow
    ) {
      add("error", "escrow_policy_mismatch", "submission escrow does not match fixedEscrow", `${prefix}.escrow`);
    }

    let envelopeAmount: bigint | null = null;
    if (submission.revealedEnvelope !== null) {
      if (!isHex(submission.revealedEnvelope)) {
        add("error", "invalid_envelope_hex", "revealedEnvelope must be hex", `${prefix}.revealedEnvelope`);
      } else {
        const envelopeBytes = fromHex(submission.revealedEnvelope);
        if (toHex(sha256(envelopeBytes)) !== submission.commitment.toLowerCase()) {
          add("error", "commitment_mismatch", "revealed envelope does not match commitment", `${prefix}.commitment`);
        }
        try {
          const envelope = decodePayloadEnvelope(envelopeBytes);
          envelopeAmount = envelope.amount ?? null;
          if (envelopeAmount !== stateAmount) {
            add("error", "amount_mismatch", "envelope amount does not match on-chain revealed amount", `${prefix}.revealedAmount`);
          }
        } catch (error) {
          add("error", "malformed_envelope", error instanceof Error ? error.message : String(error), `${prefix}.revealedEnvelope`);
        }
      }
    } else if (submission.valid) {
      add("error", "valid_without_envelope", "valid submission must include its revealed envelope", prefix);
    }

    if (receipt.mode === "Auction" && submission.valid) {
      if (envelopeAmount === null || envelopeAmount <= 0n) {
        add("error", "auction_amount_missing", "valid auction submission needs a positive amount", prefix);
      } else if (escrow !== null && envelopeAmount > escrow) {
        add("error", "bid_exceeds_escrow", "revealed bid exceeds public escrow", prefix);
      } else {
        const better = computedAmount === null || (
          receipt.clearingRule === "HighestBid"
            ? envelopeAmount > computedAmount
            : envelopeAmount < computedAmount
        );
        if (better) {
          computedWinner = bidder;
          computedAmount = envelopeAmount;
        }
      }
    }
    if (receipt.status === "Settled" && !submission.settled) {
      add("error", "unsettled_submission", "settled round contains an unsettled submission", `${prefix}.settled`);
    }
    for (const [field, value] of Object.entries(submission.evidence ?? {})) {
      if (value !== null && !isHex(value)) add("error", "invalid_evidence_hex", `${field} must be hex`, `${prefix}.evidence.${field}`);
    }
  }

  if (receipt.mode === "Auction" && (receipt.status === "Cleared" || receipt.status === "Settled")) {
    if (computedWinner !== receipt.winner || computedAmount !== winningAmount) {
      add("error", "winner_mismatch", "declared auction winner does not match valid revealed submissions", "winner");
    }
  }

  return {
    valid: !issues.some((issue) => issue.severity === "error"),
    issues,
    computedWinner: { address: computedWinner, value: computedAmount },
  };
}
