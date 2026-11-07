import { createHash } from "node:crypto";

import { Keypair } from "@stellar/stellar-sdk";
import {
  createSealedProposalRound,
  drandRoundTime,
  fetchRoundSignature,
  generateAuditorKeypair,
  openPayload,
  quicknet,
  roundInSeconds,
  sealProposal,
  serializeReceiptV2,
  SubRosaClient,
  transactionExplorerUrl,
  verifyReceiptV2,
} from "@sub-rosa/sdk";

export const COMMIT_CLOSE_BEFORE_REVEAL_SECONDS = 30;
export const REVEAL_DELAY_SECONDS = 90;
export const REVEAL_WINDOW_SECONDS = 90;

export interface QuickstartSchedule {
  revealAt: number;
  commitDeadline: number;
  revealDeadline: number;
}

interface DrandRoundInfo {
  genesis_time: number;
  period: number;
}

export function buildSchedule(
  revealRound: number,
  chain: DrandRoundInfo,
  now: number,
): QuickstartSchedule {
  const revealAt = drandRoundTime(revealRound, chain);
  const commitDeadline = revealAt - COMMIT_CLOSE_BEFORE_REVEAL_SECONDS;
  const revealDeadline = revealAt + REVEAL_WINDOW_SECONDS;
  if (!(now < commitDeadline && commitDeadline < revealAt && revealAt < revealDeadline)) {
    throw new Error("Drand schedule does not leave a valid commit and reveal window");
  }
  return { revealAt, commitDeadline, revealDeadline };
}

export function requiredEnvironment(source: NodeJS.ProcessEnv = process.env): {
  secretKey: string;
  contractId?: string;
} {
  const secretKey = source.STELLAR_SECRET_KEY?.trim();
  if (!secretKey) throw new Error("missing STELLAR_SECRET_KEY; copy .env.example to .env");
  return {
    secretKey,
    ...(source.ROUND_CONTRACT_ID?.trim()
      ? { contractId: source.ROUND_CONTRACT_ID.trim() }
      : {}),
  };
}

export function testnetTransactionUrl(hash: string): string {
  return transactionExplorerUrl("testnet", hash);
}

const sleep = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitUntil(unixSeconds: number): Promise<void> {
  while (Math.floor(Date.now() / 1_000) <= unixSeconds) {
    const remaining = unixSeconds + 1 - Math.floor(Date.now() / 1_000);
    await sleep(Math.min(3_000, remaining * 1_000));
  }
}

async function waitForRoundSignature(
  drand: ReturnType<typeof quicknet>,
  revealRound: number,
): Promise<Uint8Array> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 10; attempt += 1) {
    try {
      return await fetchRoundSignature(drand, revealRound);
    } catch (error) {
      lastError = error;
      if (attempt < 10) await sleep(2_000);
    }
  }
  throw new Error(`Drand round ${revealRound} was not available after 20 seconds`, {
    cause: lastError,
  });
}

async function clearAfterLedgerCatchup(
  client: SubRosaClient,
  roundId: bigint,
): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const preflight = await client.preflightClearV2(roundId);
    if (preflight.ok) {
      await client.clearV2(roundId);
      return;
    }
    if (preflight.error.contractErrorCode !== 16) throw preflight.error;
    await sleep(5_000);
  }
  throw new Error("Stellar ledger did not advance past revealDeadline before timeout");
}

export async function runReceiptOnlyQuickstart(): Promise<void> {
  const { secretKey, contractId } = requiredEnvironment();
  const participant = Keypair.fromSecret(secretKey).publicKey();
  const client = new SubRosaClient({
    network: "testnet",
    secretKey,
    ...(contractId ? { contractId } : {}),
  });
  const drand = quicknet();
  const chain = await drand.chain().info();
  const now = Math.floor(Date.now() / 1_000);
  const revealRound = await roundInSeconds(drand, REVEAL_DELAY_SECONDS);
  const { revealAt, commitDeadline, revealDeadline } = buildSchedule(
    revealRound,
    chain,
    now,
  );
  const auditor = generateAuditorKeypair();
  const transactionHashes: Array<{ operation: string; hash: string }> = [];

  const recordTransaction = (operation: string) => {
    const hash = client.submittedTransactionHashes.at(-1);
    if (!hash) throw new Error(`${operation} completed without a transaction hash`);
    transactionHashes.push({ operation, hash });
  };

  const roundId = await createSealedProposalRound(client, {
    itemRef: createHash("sha256")
      .update(`sub-rosa://quickstart/receipt-only/${Date.now()}`)
      .digest(),
    revealRound,
    commitDeadline,
    revealDeadline,
    auditorPubkey: auditor.publicKey,
    maxParticipants: 1,
    eligibleParticipants: [participant],
  });
  recordTransaction("create_partner_round_v2");
  console.log(`Created ReceiptOnly round ${roundId}; Drand R=${revealRound}`);

  const sealed = await sealProposal({
    round: revealRound,
    drand,
    identity: new TextEncoder().encode(participant),
    auditorPublicKey: auditor.publicKey,
    price: 2_500_000_000n,
    proposal: {
      timelineDays: 14,
      approach: "Manual review, fuzzing, and a remediation report",
      metadata: { example: "receipt-only-quickstart", schema: "v1" },
    },
  });
  await client.submitV2({ roundId, sealed, escrow: 0n });
  recordTransaction("commit_v2");
  console.log("Committed one sealed proposal with zero escrow");

  console.log(`Waiting until Drand R at ${new Date(revealAt * 1_000).toISOString()}`);
  await waitUntil(revealAt);
  const signature = await waitForRoundSignature(drand, revealRound);
  await client.openRevealV2(roundId, signature);
  recordTransaction("open_reveal_v2");

  const storedSeal = await client.getSealV2(roundId, participant);
  if (!storedSeal) throw new Error("on-chain seal is missing or expired");
  const envelope = await openPayload(storedSeal.ciphertext, drand);
  await client.revealV2({ roundId, bidder: participant, envelope });
  recordTransaction("reveal_v2");
  console.log("Opened the Drand gate and revealed the proposal");

  console.log(`Waiting to clear after ${new Date(revealDeadline * 1_000).toISOString()}`);
  await waitUntil(revealDeadline);
  await clearAfterLedgerCatchup(client, roundId);
  recordTransaction("clear_v2");

  const [round, receipt] = await Promise.all([
    client.getRoundV2(roundId),
    client.exportReceiptV2(roundId),
  ]);
  const verification = verifyReceiptV2(receipt);
  if (!verification.valid) {
    throw new Error(`receipt verification failed: ${JSON.stringify(verification.issues)}`);
  }

  const output = {
    network: "Stellar Testnet",
    contractId: client.contractId,
    roundId: roundId.toString(),
    mode: round.mode.tag,
    status: round.status.tag,
    receiptVerified: true,
    canonicalReceiptBytes: new TextEncoder().encode(serializeReceiptV2(receipt)).length,
    transactions: transactionHashes.map(({ operation, hash }) => ({
      operation,
      hash,
      explorerUrl: testnetTransactionUrl(hash),
    })),
  };
  console.log("RECEIPT_ONLY_QUICKSTART_PASSED");
  console.log(JSON.stringify(output, null, 2));
}
