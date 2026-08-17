import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  Asset,
  BASE_FEE,
  Horizon,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  type xdr,
} from "@stellar/stellar-sdk";
import {
  createAssetAuctionRound,
  fetchRoundSignature,
  generateAuditorKeypair,
  openPayload,
  quicknet,
  sealAssetBid,
  serializePublishedAuctionEvidence,
  SubRosaClient,
  verifyPublishedAuctionEvidence,
  verifyReceiptV2,
  type AuctionEvidenceTransaction,
  type PublishedAuctionEvidence,
} from "@sub-rosa/sdk";

const RPC_URL = "https://soroban-testnet.stellar.org";
const NETWORK = Networks.TESTNET;
const HORIZON_URL = "https://horizon-testnet.stellar.org";
const DEFAULT_CONTRACT_ID = "CCOVGOQQZJKZ2R55GRWBLTJTGBAMSHXZVN3ICPG3WRVMLMM6RHISC5OV";
const UNIT = 10_000_000n;
const LOT_CODE = "SRLOT";

interface PreparedRound {
  ordinal: number;
  roundId: bigint;
  bids: bigint[];
  auditor: ReturnType<typeof generateAuditorKeypair>;
  transactions: AuctionEvidenceTransaction[];
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`missing required env var ${name}`);
  return value;
}

function positiveInteger(name: string, fallback: number): number {
  const source = process.env[name]?.trim();
  if (!source) return fallback;
  const value = Number(source);
  if (!Number.isInteger(value) || value < 1 || value > 3) {
    throw new Error(`${name} must be an integer from 1 to 3`);
  }
  return value;
}

const sleep = (milliseconds: number) => new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));

async function waitUntil(timestamp: number): Promise<void> {
  while (Math.floor(Date.now() / 1000) <= timestamp) {
    const remaining = timestamp + 1 - Math.floor(Date.now() / 1000);
    console.log(`  waiting ${remaining}s`);
    await sleep(Math.min(5_000, remaining * 1_000));
  }
}

async function captured<T>(
  client: SubRosaClient,
  operation: () => Promise<T>,
): Promise<{ result: T; hash: string }> {
  const before = client.submittedTransactionHashes.length;
  const result = await operation();
  const hashes = client.submittedTransactionHashes;
  if (hashes.length !== before + 1 || !hashes[before]) {
    throw new Error("expected exactly one submitted Stellar transaction hash");
  }
  return { result, hash: hashes[before]! };
}

async function capturedWithRetry<T>(
  client: SubRosaClient,
  label: string,
  operation: () => Promise<T>,
): Promise<{ result: T; hash: string }> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      return await captured(client, operation);
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      const retryable =
        message.includes("Account not found") ||
        message.includes("tx_bad_seq") ||
        message.includes("TRY_AGAIN_LATER") ||
        message.includes("NOT_FOUND");
      if (!retryable || attempt === 5) throw error;
      console.log(`  ${label}: transient RPC failure, retry ${attempt}/5`);
      await sleep(attempt * 4_000);
    }
  }
  throw lastError;
}

async function clearAfterLedgerCatchup(
  client: SubRosaClient,
  roundId: bigint,
): Promise<{ winner: string | undefined; hash: string }> {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const preflight = await client.preflightClearV2(roundId);
    if (preflight.ok) {
      const cleared = await captured(client, () => client.clearV2(roundId));
      return { winner: cleared.result, hash: cleared.hash };
    }
    if (!preflight.error.message.includes("#16")) throw preflight.error;
    await sleep(5_000);
  }
  throw new Error(`ledger did not advance past round ${roundId} reveal deadline`);
}

function deploySac(asset: Asset, issuer: Keypair): string {
  const assetName = `${asset.code}:${asset.issuer}`;
  try {
    execFileSync(
      "stellar",
      [
        "contract",
        "asset",
        "deploy",
        "--asset",
        assetName,
        "--source-account",
        issuer.secret(),
        "--network",
        "testnet",
        "--quiet",
      ],
      { stdio: "pipe" },
    );
  } catch {
    // SAC addresses are deterministic; an existing deployment is reusable.
  }
  return execFileSync(
    "stellar",
    ["contract", "id", "asset", "--asset", assetName, "--network", "testnet", "--quiet"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  ).trim();
}

async function main() {
  const contractId = process.env.ROUND_CONTRACT_ID?.trim() || DEFAULT_CONTRACT_ID;
  const roundCount = positiveInteger("INSTA_ROUND_COUNT", 1);
  const evidenceDirectory = resolve(
    process.env.EVIDENCE_DIR?.trim() ||
      resolve(import.meta.dirname, "../../apps/web/public/instawards/receipts"),
  );
  const issuer = Keypair.fromSecret(required("ISSUER_SECRET"));
  const seller = Keypair.fromSecret(required("SELLER_SECRET"));
  const bidders = [
    Keypair.fromSecret(required("BIDDER1_SECRET")),
    Keypair.fromSecret(required("BIDDER2_SECRET")),
    Keypair.fromSecret(required("BIDDER3_SECRET")),
  ];
  const bidderAddresses = bidders.map((bidder) => bidder.publicKey());
  const horizon = new Horizon.Server(HORIZON_URL);
  const paymentAsset = Asset.native();
  const lotAsset = new Asset(LOT_CODE, issuer.publicKey());

  async function submitClassic(source: Keypair, operation: xdr.Operation): Promise<string> {
    const account = await horizon.loadAccount(source.publicKey());
    const transaction = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK,
    }).addOperation(operation).setTimeout(120).build();
    transaction.sign(source);
    return (await horizon.submitTransaction(transaction)).hash;
  }

  async function hasTrustline(address: string, asset: Asset): Promise<boolean> {
    const account = await horizon.loadAccount(address);
    return account.balances.some(
      (balance) =>
        "asset_code" in balance &&
        balance.asset_code === asset.code &&
        balance.asset_issuer === asset.issuer,
    );
  }

  console.log("Preparing native testnet XLM escrow and auction-lot trustlines");
  for (const account of [seller, ...bidders]) {
    if (!(await hasTrustline(account.publicKey(), lotAsset))) {
      await submitClassic(account, Operation.changeTrust({ asset: lotAsset }));
    }
  }
  await submitClassic(issuer, Operation.payment({
    destination: seller.publicKey(),
    asset: lotAsset,
    amount: String(roundCount),
  }));

  const paymentSac = paymentAsset.contractId(NETWORK);
  const lotSac = deploySac(lotAsset, issuer);
  const sellerClient = new SubRosaClient({
    network: "testnet",
    contractId,
    secretKey: seller.secret(),
  });
  const bidderClients = bidders.map((bidder) => new SubRosaClient({
    network: "testnet",
    contractId,
    secretKey: bidder.secret(),
  }));
  const drand = quicknet();
  const chain = await drand.chain().info();
  const now = Math.floor(Date.now() / 1000);
  const revealRound = Math.ceil((now + 300 - Number(chain.genesis_time)) / Number(chain.period));
  const revealAt = Number(chain.genesis_time) + Number(chain.period) * revealRound;
  const commitDeadline = revealAt - 60;
  const revealDeadline = revealAt + 240;
  const fixedEscrow = 25n * UNIT;
  const bidSets = [
    [12n, 18n, 15n],
    [21n, 19n, 17n],
    [10n, 14n, 22n],
  ].map((set) => set.map((value) => value * UNIT));
  const rounds: PreparedRound[] = [];

  console.log(`Creating ${roundCount} Core v2 Auction round(s), reveal at Drand #${revealRound}`);
  for (let index = 0; index < roundCount; index += 1) {
    const ordinal = index + 1;
    const auditor = generateAuditorKeypair();
    const created = await captured(sellerClient, () => createAssetAuctionRound(sellerClient, {
      itemRef: createHash("sha256").update(`sub-rosa://instawards/auction-${ordinal}`).digest(),
      paymentAsset: paymentSac,
      lotAsset: lotSac,
      lotAmount: UNIT,
      fixedEscrow,
      revealRound,
      commitDeadline,
      revealDeadline,
      auditorPubkey: auditor.publicKey,
      maxParticipants: 3,
      eligibleParticipants: bidderAddresses,
    }));
    const prepared: PreparedRound = {
      ordinal,
      roundId: created.result,
      bids: bidSets[index]!,
      auditor,
      transactions: [{
        phase: "create_round",
        hash: created.hash,
        actor: seller.publicKey(),
      }],
    };
    rounds.push(prepared);
    console.log(`  round ${prepared.roundId} created`);
  }

  for (const round of rounds) {
    console.log(`Submitting 3 sealed bids to round ${round.roundId}`);
    for (let index = 0; index < bidders.length; index += 1) {
      const bidder = bidders[index]!;
      const bidderClient = bidderClients[index]!;
      const sealed = await sealAssetBid({
        round: revealRound,
        drand,
        amount: round.bids[index]!,
        identity: new TextEncoder().encode(bidder.publicKey()),
        auditorPublicKey: round.auditor.publicKey,
      });
      const committed = await capturedWithRetry(bidderClient, `round ${round.roundId} commit`, () => bidderClient.submitV2({
        roundId: round.roundId,
        sealed,
        escrow: fixedEscrow,
      }));
      round.transactions.push({
        phase: "commit",
        hash: committed.hash,
        actor: bidder.publicKey(),
        note: `Bidder ${index + 1} sealed commit`,
      });
    }
  }

  console.log("Waiting for the shared Drand reveal boundary");
  await waitUntil(revealAt);
  const signature = await fetchRoundSignature(drand, revealRound);

  for (const round of rounds) {
    const opened = await capturedWithRetry(sellerClient, `round ${round.roundId} open`, () => sellerClient.openRevealV2(round.roundId, signature));
    round.transactions.push({
      phase: "open_reveal",
      hash: opened.hash,
      actor: seller.publicKey(),
    });
    for (let index = 0; index < bidders.length; index += 1) {
      const bidder = bidders[index]!;
      const storedSeal = await sellerClient.getSealV2(round.roundId, bidder.publicKey());
      if (!storedSeal) throw new Error(`missing stored seal for ${bidder.publicKey()}`);
      const envelope = await openPayload(storedSeal.ciphertext, drand);
      const revealed = await capturedWithRetry(sellerClient, `round ${round.roundId} reveal`, () => sellerClient.revealV2({
        roundId: round.roundId,
        bidder: bidder.publicKey(),
        envelope,
      }));
      round.transactions.push({
        phase: "reveal",
        hash: revealed.hash,
        actor: seller.publicKey(),
        note: `Bidder ${index + 1} envelope reveal`,
      });
    }
  }

  console.log("Waiting for the clearing boundary");
  await waitUntil(revealDeadline);
  await mkdir(evidenceDirectory, { recursive: true });
  const manifest: Array<{ slug: string; roundId: string; title: string; path: string }> = [];

  for (const round of rounds) {
    const cleared = await clearAfterLedgerCatchup(sellerClient, round.roundId);
    round.transactions.push({ phase: "clear", hash: cleared.hash, actor: seller.publicKey() });
    const settled = await capturedWithRetry(sellerClient, `round ${round.roundId} settle`, () => sellerClient.settleV2(round.roundId));
    round.transactions.push({
      phase: "settle_and_refund",
      hash: settled.hash,
      actor: seller.publicKey(),
      note: "Winner payment, lot transfer, winner surplus, and loser refunds execute atomically",
    });

    const receipt = await sellerClient.exportReceiptV2(round.roundId);
    const canonicalVerification = verifyReceiptV2(receipt);
    if (!canonicalVerification.valid) {
      throw new Error(`round ${round.roundId} receipt failed: ${JSON.stringify(canonicalVerification.issues)}`);
    }
    const slug = `instawards-auction-${round.ordinal}`;
    const evidence: PublishedAuctionEvidence = {
      version: 1,
      schema: "sub-rosa/published-auction-evidence/v1",
      slug,
      title: `Instawards sealed auction ${round.ordinal}`,
      network: "testnet",
      generatedAt: new Date().toISOString(),
      contractId,
      roundId: round.roundId.toString(),
      receipt,
      transactions: round.transactions,
      settlement: {
        transactionHash: settled.hash,
        refundTransactionHash: settled.hash,
        atomic: true,
        effects: [
          "Winning payment transferred to the seller",
          "Winner's unused fixed escrow refunded",
          "Every losing bidder's fixed escrow refunded",
          "Auction lot transferred to the winner",
        ],
      },
    };
    const verification = verifyPublishedAuctionEvidence(evidence, { minimumBidders: 3 });
    if (!verification.valid) {
      throw new Error(`round ${round.roundId} evidence failed: ${JSON.stringify(verification.issues)}`);
    }
    const fileName = `${slug}.json`;
    await writeFile(resolve(evidenceDirectory, fileName), serializePublishedAuctionEvidence(evidence), "utf8");
    manifest.push({
      slug,
      roundId: round.roundId.toString(),
      title: evidence.title,
      path: `/instawards/receipts/${fileName}`,
    });
    console.log(`  round ${round.roundId}: settled and verified (${settled.hash})`);
  }

  await writeFile(
    resolve(evidenceDirectory, "../manifest.json"),
    `${JSON.stringify({
      schema: "sub-rosa/instawards-manifest/v1",
      generatedAt: new Date().toISOString(),
      contractId,
      rounds: manifest,
    }, null, 2)}\n`,
    "utf8",
  );
  console.log(`Evidence written to ${evidenceDirectory}`);
  console.log("INSTAWARDS TESTNET AUCTIONS PASSED");
}

main().catch((error) => {
  console.error("INSTAWARDS TESTNET AUCTIONS FAILED");
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
