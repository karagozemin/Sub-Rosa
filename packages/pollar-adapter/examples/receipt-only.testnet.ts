/**
 * Live TESTNET proof for the optional Pollar adapter.
 *
 * Supply a local, untracked module exporting an authenticated, READY
 * PollarClient:
 *
 *   POLLAR_SESSION_MODULE=/absolute/path/to/pollar-session.mjs pnpm test:e2e -- --run
 *
 * The session module owns the application's normal Pollar login flow and must
 * export either `pollar` or a default PollarClient instance. There is no secret
 * key or alternate-wallet fallback.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

import { isPollarClient, type PollarClient } from "@pollar/core";
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

import { createPollarSubRosaClient } from "../src/index.js";

const RPC_URL = "https://soroban-testnet.stellar.org";
const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const nowSeconds = () => Math.floor(Date.now() / 1_000);

async function waitUntil(timestamp: number): Promise<void> {
  while (nowSeconds() <= timestamp) {
    await sleep(Math.min(3_000, (timestamp + 1 - nowSeconds()) * 1_000));
  }
}

async function clearAfterLedgerCatchup(
  client: ReturnType<typeof createPollarSubRosaClient>["client"],
  roundId: bigint,
): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
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

async function transactionStatuses(hashes: readonly string[]) {
  const server = new rpc.Server(RPC_URL);
  return Promise.all(
    hashes.map(async (hash) => {
      const result = await server.getTransaction(hash);
      return { hash, status: result.status };
    }),
  );
}

export async function runPollarReceiptOnlyTestnet(pollar: PollarClient) {
  await pollar.ready();
  assert.equal(pollar.getNetwork(), "testnet", "Pollar must be configured for testnet");
  const wallet = pollar.getWallet();
  assert.ok(wallet, "Pollar must have an authenticated Stellar wallet");
  assert.equal(wallet.provisioning, "READY", "Pollar wallet must be READY");
  assert.notEqual(wallet.custody, "smart", "Initial proof requires a classic G-address wallet");

  const { client, signer } = createPollarSubRosaClient({ pollar, rpcUrl: RPC_URL });
  const participant = signer.publicKey;
  const drand = quicknet();
  const chain = await drand.chain().info();
  const now = nowSeconds();
  const revealRound = Math.ceil((now + 45 - Number(chain.genesis_time)) / Number(chain.period)) + 1;
  const revealAt = drandRoundTime(revealRound, chain);
  const commitDeadline = now + 25;
  const revealDeadline = revealAt + 45;
  const auditor = generateAuditorKeypair();
  const hashes: Array<{ operation: string; hash: string }> = [];

  const recordHash = (operation: string) => {
    const hash = client.submittedTransactionHashes.at(-1);
    if (!hash) throw new Error(`${operation} completed without a submitted transaction hash`);
    hashes.push({ operation, hash });
  };

  const roundId = await createSealedProposalRound(client, {
    itemRef: createHash("sha256").update("sub-rosa://pollar-adapter/testnet/v1").digest(),
    revealRound,
    commitDeadline,
    revealDeadline,
    auditorPubkey: auditor.publicKey,
    maxParticipants: 1,
    eligibleParticipants: [participant],
  });
  recordHash("create_round");

  const sealed = await sealProposal({
    round: revealRound,
    drand,
    identity: new TextEncoder().encode(participant),
    auditorPublicKey: auditor.publicKey,
    price: 1n,
    proposal: {
      timelineDays: 1,
      approach: "non-sensitive testnet ReceiptOnly verification",
      metadata: { integration: "@sub-rosa/pollar-adapter" },
    },
  });
  await client.submitV2({ roundId, sealed, escrow: 0n });
  recordHash("commit_v2");

  await waitUntil(revealAt);
  const signature = await fetchRoundSignature(drand, revealRound);
  await client.openRevealV2(roundId, signature);
  recordHash("open_reveal_v2");

  const storedSeal = await client.getSealV2(roundId, participant);
  if (!storedSeal) throw new Error("Committed Pollar seal is missing on-chain");
  const envelope = await openPayload(storedSeal.ciphertext, drand);
  await client.revealV2({ roundId, bidder: participant, envelope });
  recordHash("reveal_v2");

  await waitUntil(revealDeadline);
  await clearAfterLedgerCatchup(client, roundId);
  recordHash("clear_v2");

  const receipt = await client.exportReceiptV2(roundId);
  const verification = verifyReceiptV2(receipt);
  if (!verification.valid) {
    throw new Error(`Canonical receipt verification failed: ${JSON.stringify(verification.issues)}`);
  }
  const receiptJson = serializeReceiptV2(receipt);
  const receiptHash = createHash("sha256").update(receiptJson).digest("hex");
  const statuses = await transactionStatuses(hashes.map(({ hash }) => hash));
  assert.ok(statuses.every(({ status }) => status === "SUCCESS"), "Every testnet transaction must be SUCCESS");

  return {
    network: "testnet" as const,
    wallet: participant,
    contractId: client.contractId,
    roundId: roundId.toString(),
    transactions: hashes.map((entry, index) => ({ ...entry, status: statuses[index]?.status })),
    receiptHash,
    receiptVerified: true,
  };
}

async function main() {
  if (!process.argv.includes("--run")) {
    throw new Error("Pass --run to execute real Pollar-signed Stellar TESTNET transactions");
  }
  const modulePath = process.env.POLLAR_SESSION_MODULE;
  if (!modulePath) {
    throw new Error(
      "POLLAR_SESSION_MODULE is required and must export an authenticated real PollarClient; no fallback signer is allowed",
    );
  }
  const sessionModule = (await import(pathToFileURL(modulePath).href)) as {
    default?: unknown;
    pollar?: unknown;
  };
  const pollar = sessionModule.pollar ?? sessionModule.default;
  if (!isPollarClient(pollar)) {
    throw new Error("POLLAR_SESSION_MODULE did not export a real PollarClient instance");
  }
  const evidence = await runPollarReceiptOnlyTestnet(pollar);
  console.log("POLLAR x SUB ROSA TESTNET RECEIPT-ONLY LIFECYCLE PASSED");
  console.log(JSON.stringify(evidence, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error("POLLAR x SUB ROSA TESTNET RECEIPT-ONLY LIFECYCLE FAILED");
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
