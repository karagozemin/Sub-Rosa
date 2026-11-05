import type { PollarClient } from "@pollar/core";
import { rpc } from "@stellar/stellar-sdk";
import {
  createSealedProposalRound,
  drandRoundTime,
  fetchRoundSignature,
  generateAuditorKeypair,
  openPayload,
  quicknet,
  sealProposal,
  serializeReceiptV2,
  verifyReceiptV2,
} from "@sub-rosa/sdk";

import { createPollarSubRosaClient } from "./index.js";

export {
  runPollarAuthEntryTestnet,
  PollarAuthEntrySubmissionError,
  type PollarAuthEntryEvidence,
  type PollarAuthEntryProgress,
  type PollarAuthEntryRpcResult,
  type PollarAuthEntryStage,
  type PollarAuthEntryTestOptions,
} from "./testnet-auth-entry.js";

export type PollarTestnetStage =
  | "preflight"
  | "create_round"
  | "sealed_commit"
  | "wait_for_drand"
  | "open_reveal"
  | "reveal"
  | "wait_for_clear"
  | "clear"
  | "verify_receipt"
  | "complete";

export interface PollarTestnetProgress {
  stage: PollarTestnetStage;
  message: string;
}

export interface PollarTestnetLifecycleOptions {
  rpcUrl?: string;
  /** Time available for the user to approve create + commit. Default: 180s. */
  commitWindowSeconds?: number;
  /** Reveal deadline after the Drand round time. Default: 180s. */
  revealWindowSeconds?: number;
  onProgress?: (progress: PollarTestnetProgress) => void;
}

export interface PollarTestnetTransactionEvidence {
  operation: string;
  hash: string;
  status: string;
  explorerUrl: string;
}

export interface PollarTestnetEvidence {
  evidenceVersion: 1;
  generatedAt: string;
  network: "testnet";
  wallet: string;
  contractId: string;
  roundId: string;
  transactions: PollarTestnetTransactionEvidence[];
  receiptHash: string;
  receiptVerified: true;
}

const DEFAULT_RPC_URL = "https://soroban-testnet.stellar.org";
const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const nowSeconds = () => Math.floor(Date.now() / 1_000);

function requireSafeWindow(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 60 || value > 900) {
    throw new Error(`${label} must be an integer between 60 and 900 seconds`);
  }
  return value;
}

async function waitUntil(timestamp: number): Promise<void> {
  while (nowSeconds() <= timestamp) {
    await sleep(Math.min(3_000, (timestamp + 1 - nowSeconds()) * 1_000));
  }
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Bytes(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

async function clearAfterLedgerCatchup(
  client: ReturnType<typeof createPollarSubRosaClient>["client"],
  roundId: bigint,
): Promise<void> {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const preflight = await client.preflightClearV2(roundId);
    if (preflight.ok) {
      await client.clearV2(roundId);
      return;
    }
    if (!preflight.error.message.includes("#16")) throw preflight.error;
    await sleep(5_000);
  }
  throw new Error("Stellar testnet ledger did not advance past reveal_deadline in time");
}

function requireClassicReadyPollarWallet(pollar: PollarClient): string {
  if (pollar.getNetwork() !== "testnet") throw new Error("Pollar must be configured for testnet");
  const auth = pollar.getAuthState();
  if (auth.step !== "authenticated" || !auth.verified) {
    throw new Error("Pollar session must be authenticated and server-verified");
  }
  const wallet = pollar.getWallet();
  if (!wallet) throw new Error("Pollar has no authenticated Stellar wallet");
  if (wallet.custody === "smart" || !wallet.address.startsWith("G")) {
    throw new Error("The initial proof requires a classic Pollar G-address wallet");
  }
  if (wallet.provisioning !== undefined && wallet.provisioning !== "READY") {
    throw new Error(`Pollar wallet provisioning is ${wallet.provisioning}; wait for READY`);
  }
  if (wallet.existsOnStellar === false) {
    throw new Error("The Pollar G-address is not funded/created on Stellar testnet yet");
  }
  return wallet.address;
}

export async function runPollarReceiptOnlyTestnet(
  pollar: PollarClient,
  options: PollarTestnetLifecycleOptions = {},
): Promise<PollarTestnetEvidence> {
  await pollar.ready();
  const participant = requireClassicReadyPollarWallet(pollar);
  const rpcUrl = options.rpcUrl ?? DEFAULT_RPC_URL;
  const commitWindow = requireSafeWindow(options.commitWindowSeconds ?? 180, "commitWindowSeconds");
  const revealWindow = requireSafeWindow(options.revealWindowSeconds ?? 180, "revealWindowSeconds");
  const progress = (stage: PollarTestnetStage, message: string) => options.onProgress?.({ stage, message });

  progress("preflight", "Validated the authenticated Pollar testnet G-address");
  const server = new rpc.Server(rpcUrl);
  const network = await server.getNetwork();
  if (network.passphrase !== "Test SDF Network ; September 2015") {
    throw new Error("Configured RPC is not Stellar testnet");
  }

  const { client, signer } = createPollarSubRosaClient({ pollar, rpcUrl });
  if (signer.publicKey !== participant) throw new Error("Pollar signer changed during lifecycle setup");

  const drand = quicknet();
  const chain = await drand.chain().info();
  const now = nowSeconds();
  const revealTarget = now + commitWindow + 30;
  const revealRound = Math.ceil((revealTarget - Number(chain.genesis_time)) / Number(chain.period)) + 1;
  const revealAt = drandRoundTime(revealRound, chain);
  const commitDeadline = now + commitWindow;
  const revealDeadline = revealAt + revealWindow;
  const auditor = generateAuditorKeypair();
  const hashes: Array<{ operation: string; hash: string }> = [];

  const recordHash = (operation: string) => {
    const hash = client.submittedTransactionHashes.at(-1);
    if (!hash) throw new Error(`${operation} completed without a transaction hash`);
    hashes.push({ operation, hash });
  };

  progress("create_round", "Approve the Pollar signature for ReceiptOnly round creation");
  const roundId = await createSealedProposalRound(client, {
    itemRef: await sha256Bytes(`sub-rosa://pollar-adapter/testnet/${Date.now()}`),
    revealRound,
    commitDeadline,
    revealDeadline,
    auditorPubkey: auditor.publicKey,
    maxParticipants: 1,
    eligibleParticipants: [participant],
  });
  recordHash("create_partner_round_v2");

  progress("sealed_commit", "Approve the Pollar signature for the sealed zero-escrow commit");
  const sealed = await sealProposal({
    round: revealRound,
    drand,
    identity: new TextEncoder().encode(participant),
    auditorPublicKey: auditor.publicKey,
    price: 1n,
    proposal: {
      timelineDays: 1,
      approach: "non-sensitive Pollar adapter testnet verification",
      metadata: { integration: "@sub-rosa/pollar-adapter", evidence: "public-testnet" },
    },
  });
  await client.submitV2({ roundId, sealed, escrow: 0n });
  recordHash("commit_v2");

  progress("wait_for_drand", `Waiting for Drand round ${revealRound}`);
  await waitUntil(revealAt);
  const signature = await fetchRoundSignature(drand, revealRound);

  progress("open_reveal", "Approve the Pollar signature to open the reveal phase");
  await client.openRevealV2(roundId, signature);
  recordHash("open_reveal_v2");

  const storedSeal = await client.getSealV2(roundId, participant);
  if (!storedSeal) throw new Error("Committed Pollar seal is missing on-chain");
  const envelope = await openPayload(storedSeal.ciphertext, drand);
  progress("reveal", "Approve the Pollar signature to reveal the sealed proposal");
  await client.revealV2({ roundId, bidder: participant, envelope });
  recordHash("reveal_v2");

  progress("wait_for_clear", "Waiting for the on-chain reveal deadline");
  await waitUntil(revealDeadline);
  progress("clear", "Approve the Pollar signature to clear the ReceiptOnly round");
  await clearAfterLedgerCatchup(client, roundId);
  recordHash("clear_v2");

  progress("verify_receipt", "Exporting and independently verifying the canonical receipt");
  const receipt = await client.exportReceiptV2(roundId);
  const verification = verifyReceiptV2(receipt);
  if (!verification.valid) {
    throw new Error(`Canonical receipt verification failed: ${JSON.stringify(verification.issues)}`);
  }
  const receiptHash = await sha256Hex(serializeReceiptV2(receipt));
  const transactions = await Promise.all(
    hashes.map(async ({ operation, hash }) => {
      const result = await server.getTransaction(hash);
      if (result.status !== "SUCCESS") {
        throw new Error(`${operation} transaction ${hash} has RPC status ${result.status}`);
      }
      return {
        operation,
        hash,
        status: result.status,
        explorerUrl: `https://stellar.expert/explorer/testnet/tx/${hash}`,
      };
    }),
  );

  progress("complete", "Pollar-signed lifecycle and canonical receipt verification succeeded");
  return {
    evidenceVersion: 1,
    generatedAt: new Date().toISOString(),
    network: "testnet",
    wallet: participant,
    contractId: client.contractId,
    roundId: roundId.toString(),
    transactions,
    receiptHash,
    receiptVerified: true,
  };
}
