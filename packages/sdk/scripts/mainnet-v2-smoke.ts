import { drandRoundTime } from "@sub-rosa/tlock";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomBytes } from "node:crypto";

import { rpc } from "@stellar/stellar-sdk";
import {
  SUB_ROSA_DEPLOYMENTS,
  SubRosaClient,
  assertMainnetConfirmed,
  assertMicroAmounts,
  contractExplorerUrl,
  createAssetAuctionRound,
  fetchContractWasmHash,
  nativeXlmSacId,
  resolveSubRosaDeployment,
  sealAssetBid,
  serializeReceiptV2,
  transactionExplorerUrl,
  verifyReceiptV2,
} from "../src/index.js";
import {
  fetchRoundSignature,
  generateAuditorKeypair,
  openPayload,
  quicknet,
} from "@sub-rosa/tlock";
import { resolveScriptSigner } from "./script-signer.js";

const LOT_AMOUNT = 100_000n; // 0.01 XLM
const BID_AMOUNT = 500_000n; // 0.05 XLM
const ESCROW_AMOUNT = 1_000_000n; // 0.1 XLM

type TransactionLabel =
  | "create"
  | "commit"
  | "openReveal"
  | "reveal"
  | "clear"
  | "settle";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`missing required env var ${name}`);
  return value;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitUntil(timestamp: number): Promise<void> {
  while (Math.floor(Date.now() / 1000) <= timestamp) {
    const remaining = timestamp + 1 - Math.floor(Date.now() / 1000);
    await sleep(Math.min(5_000, remaining * 1_000));
  }
}

async function submitted<T>(
  label: TransactionLabel,
  client: SubRosaClient,
  action: () => Promise<T>,
  hashes: Partial<Record<TransactionLabel, string>>,
): Promise<T> {
  const before = client.submittedTransactionHashes.length;
  const result = await action();
  const hash = client.submittedTransactionHashes[before];
  if (!hash) throw new Error(`${label} succeeded but no transaction hash was captured`);
  hashes[label] = hash;
  console.log(`${label}: ${transactionExplorerUrl("mainnet", hash)}`);
  return result;
}

async function clearAfterLedgerCatchup(
  client: SubRosaClient,
  roundId: bigint,
  hashes: Partial<Record<TransactionLabel, string>>,
): Promise<void> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const preflight = await client.preflightClearV2(roundId);
    if (preflight.ok) {
      await submitted("clear", client, () => client.clearV2(roundId), hashes);
      return;
    }
    if (!preflight.error.message.includes("#16")) throw preflight.error;
    await sleep(5_000);
  }
  throw new Error("ledger did not advance past reveal deadline before timeout");
}

async function main() {
  const execute = process.argv.includes("--execute");
  const deployment = SUB_ROSA_DEPLOYMENTS.mainnet;
  const contractId = required("ROUND_CONTRACT_ID");
  const resolved = resolveSubRosaDeployment("mainnet", {
    contractId,
    rpcUrl: process.env.RPC_URL,
    networkPassphrase: process.env.NETWORK_PASSPHRASE,
  });
  const { rpcUrl, networkPassphrase } = resolved;
  assertMicroAmounts(BID_AMOUNT, ESCROW_AMOUNT);

  console.log("Sub Rosa Core v2 mainnet capped smoke");
  console.log("Contract:", contractExplorerUrl("mainnet", contractId));
  console.log("Lot:     0.01 XLM");
  console.log("Bid:     0.05 XLM");
  console.log("Escrow:  0.10 XLM");
  console.log(`Mode:    ${execute ? "EXECUTE" : "DRY-RUN"}`);

  if (!execute) {
    console.log("Transactions submitted: 0");
    console.log("Execute only after reviewing the contract and funding both signers:");
    console.log(
      "  MAINNET_CONFIRM=SUB_ROSA_MAINNET ROUND_CONTRACT_ID=C... OPERATOR_IDENTITY=... BIDDER_IDENTITY=... pnpm mainnet:v2:smoke -- --execute",
    );
    return;
  }

  assertMainnetConfirmed();
  const operator = await resolveScriptSigner({
    secret: process.env.OPERATOR_SECRET,
    identity: process.env.OPERATOR_IDENTITY,
    secretEnvName: "OPERATOR_SECRET",
    identityEnvName: "OPERATOR_IDENTITY",
    networkPassphrase,
    rpcUrl,
  });
  const bidder = await resolveScriptSigner({
    secret: process.env.BIDDER_SECRET,
    identity: process.env.BIDDER_IDENTITY,
    secretEnvName: "BIDDER_SECRET",
    identityEnvName: "BIDDER_IDENTITY",
    networkPassphrase,
    rpcUrl,
  });
  if (operator.publicKey === bidder.publicKey) {
    throw new Error("operator and bidder must be different accounts");
  }

  const reader = new SubRosaClient({
    network: "mainnet",
    rpcUrl,
    contractId,
    publicKey: operator.publicKey,
  });
  const onChainWasm = await fetchContractWasmHash(
    new rpc.Server(rpcUrl),
    contractId,
  );
  if (onChainWasm.toLowerCase() !== deployment.wasmHash) {
    throw new Error(
      `contract WASM ${onChainWasm} != reviewed Core v2 ${deployment.wasmHash}`,
    );
  }

  const sellerClient = new SubRosaClient({
    network: "mainnet",
    rpcUrl,
    contractId,
    publicKey: operator.publicKey,
    signTransaction: operator.signTransaction,
    ...(operator.signAuthEntry
      ? { signAuthEntry: operator.signAuthEntry }
      : {}),
  });
  const bidderClient = new SubRosaClient({
    network: "mainnet",
    rpcUrl,
    contractId,
    publicKey: bidder.publicKey,
    signTransaction: bidder.signTransaction,
    ...(bidder.signAuthEntry ? { signAuthEntry: bidder.signAuthEntry } : {}),
  });
  const hashes: Partial<Record<TransactionLabel, string>> = {};
  const drand = quicknet();
  const chain = await drand.chain().info();
  const now = Math.floor(Date.now() / 1000);
  const revealRound = Math.ceil(
    (now + 60 - Number(chain.genesis_time)) / Number(chain.period),
  ) + 1;
  const revealAt =
    drandRoundTime(revealRound, chain);
  const revealDeadline = revealAt + 60;
  const auditor = generateAuditorKeypair();
  const nativeSac = nativeXlmSacId(networkPassphrase);

  const roundId = await submitted(
    "create",
    sellerClient,
    () =>
      createAssetAuctionRound(sellerClient, {
        itemRef: randomBytes(32),
        paymentAsset: nativeSac,
        lotAsset: nativeSac,
        lotAmount: LOT_AMOUNT,
        fixedEscrow: ESCROW_AMOUNT,
        revealRound,
        commitDeadline: now + 30,
        revealDeadline,
        auditorPubkey: auditor.publicKey,
        maxParticipants: 2,
        eligibleParticipants: [bidder.publicKey],
      }),
    hashes,
  );

  const sealed = await sealAssetBid({
    round: revealRound,
    drand,
    amount: BID_AMOUNT,
    identity: new TextEncoder().encode(bidder.publicKey),
    auditorPublicKey: auditor.publicKey,
  });
  await submitted(
    "commit",
    bidderClient,
    () => bidderClient.submitV2({ roundId, sealed, escrow: ESCROW_AMOUNT }),
    hashes,
  );

  await waitUntil(revealAt);
  await submitted(
    "openReveal",
    sellerClient,
    async () =>
      sellerClient.openRevealV2(
        roundId,
        await fetchRoundSignature(drand, revealRound),
      ),
    hashes,
  );
  const storedSeal = await reader.getSealV2(roundId, bidder.publicKey);
  if (!storedSeal) throw new Error("on-chain seal is missing");
  const envelope = await openPayload(storedSeal.ciphertext, drand);
  await submitted(
    "reveal",
    sellerClient,
    () =>
      sellerClient.revealV2({
        roundId,
        bidder: bidder.publicKey,
        envelope,
      }),
    hashes,
  );

  await waitUntil(revealDeadline);
  await clearAfterLedgerCatchup(sellerClient, roundId, hashes);
  await submitted(
    "settle",
    sellerClient,
    () => sellerClient.settleV2(roundId),
    hashes,
  );

  const receipt = await reader.exportReceiptV2(roundId);
  const verification = verifyReceiptV2(receipt);
  if (!verification.valid) {
    throw new Error(`receipt verification failed: ${JSON.stringify(verification.issues)}`);
  }

  const artifactPath = resolve(
    process.env.SMOKE_ARTIFACT ||
      "artifacts/deployments/core-v2-mainnet-smoke.local.json",
  );
  const artifact = {
    protocolVersion: "core-v2",
    network: "mainnet",
    contractId,
    wasmHash: onChainWasm,
    roundId: roundId.toString(),
    amounts: {
      lotStroops: LOT_AMOUNT.toString(),
      bidStroops: BID_AMOUNT.toString(),
      escrowStroops: ESCROW_AMOUNT.toString(),
    },
    transactionHashes: hashes,
    transactionLinks: Object.fromEntries(
      Object.entries(hashes).map(([label, hash]) => [
        label,
        transactionExplorerUrl("mainnet", hash),
      ]),
    ),
    receipt: JSON.parse(serializeReceiptV2(receipt)),
    receiptVerified: true,
    completedAt: new Date().toISOString(),
  };
  await mkdir(dirname(artifactPath), { recursive: true });
  await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, {
    mode: 0o600,
  });

  console.log("CORE V2 MAINNET CAPPED SMOKE PASSED");
  console.log(`Round: ${roundId}`);
  console.log(`Transactions: ${Object.keys(hashes).length}`);
  console.log(`Local evidence: ${artifactPath}`);
}

main().catch((error) => {
  console.error("CORE V2 MAINNET SMOKE FAILED");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
