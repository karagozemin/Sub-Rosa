import { drandRoundTime } from "@sub-rosa/tlock";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

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
  fetchRoundSignature,
  generateAuditorKeypair,
  openPayload,
  quicknet,
} from "@sub-rosa/tlock";

import {
  createAssetAuctionRound,
  sealAssetBid,
  SubRosaClient,
  verifyReceiptV2,
} from "../src/index.js";

const RPC_URL = "https://soroban-testnet.stellar.org";
const NETWORK = Networks.TESTNET;
const DEFAULT_CONTRACT_ID = "CCOVGOQQZJKZ2R55GRWBLTJTGBAMSHXZVN3ICPG3WRVMLMM6RHISC5OV";
const PAYMENT_CODE = "SRUSD";
const LOT_CODE = "SRLOT";
const UNIT = 10_000_000n;

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing required env var ${name}`);
  return value;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitUntil(timestamp: number): Promise<void> {
  while (Math.floor(Date.now() / 1000) <= timestamp) {
    await sleep(Math.min(3_000, (timestamp + 1 - Math.floor(Date.now() / 1000)) * 1_000));
  }
}

async function clearAfterLedgerCatchup(client: SubRosaClient, roundId: bigint) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const preflight = await client.preflightClearV2(roundId);
    if (preflight.ok) return client.clearV2(roundId);
    if (!preflight.error.message.includes("#16")) throw preflight.error;
    await sleep(5_000);
  }
  throw new Error("ledger did not advance past reveal_deadline before timeout");
}

async function main() {
  const contractId = process.env.ROUND_CONTRACT_ID ?? DEFAULT_CONTRACT_ID;
  const issuer = Keypair.fromSecret(required("ISSUER_SECRET"));
  const seller = Keypair.fromSecret(required("OPERATOR_SECRET"));
  const bidder = Keypair.fromSecret(required("BIDDER_SECRET"));
  const horizon = new Horizon.Server("https://horizon-testnet.stellar.org");
  const paymentAsset = new Asset(PAYMENT_CODE, issuer.publicKey());
  const lotAsset = new Asset(LOT_CODE, issuer.publicKey());

  async function submit(source: Keypair, operation: xdr.Operation) {
    const account = await horizon.loadAccount(source.publicKey());
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK,
    })
      .addOperation(operation)
      .setTimeout(120)
      .build();
    tx.sign(source);
    await horizon.submitTransaction(tx);
  }

  async function hasTrustline(address: string, asset: Asset) {
    const account = await horizon.loadAccount(address);
    return account.balances.some(
      (balance) =>
        "asset_code" in balance &&
        balance.asset_code === asset.code &&
        balance.asset_issuer === asset.issuer,
    );
  }

  async function balance(address: string, asset: Asset): Promise<number> {
    const account = await horizon.loadAccount(address);
    const entry = account.balances.find(
      (candidate) =>
        "asset_code" in candidate &&
        candidate.asset_code === asset.code &&
        candidate.asset_issuer === asset.issuer,
    );
    return entry ? Number(entry.balance) : 0;
  }

  for (const account of [seller, bidder]) {
    for (const asset of [paymentAsset, lotAsset]) {
      if (!(await hasTrustline(account.publicKey(), asset))) {
        await submit(account, Operation.changeTrust({ asset }));
      }
    }
  }
  await submit(
    issuer,
    Operation.payment({
      destination: bidder.publicKey(),
      asset: paymentAsset,
      amount: "100",
    }),
  );
  await submit(
    issuer,
    Operation.payment({
      destination: seller.publicKey(),
      asset: lotAsset,
      amount: "1",
    }),
  );

  function deploySac(asset: Asset) {
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
      // The deterministic SAC may already be deployed from an earlier run.
    }
    return execFileSync(
      "stellar",
      ["contract", "id", "asset", "--asset", assetName, "--network", "testnet", "--quiet"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
  }

  const paymentSac = deploySac(paymentAsset);
  const lotSac = deploySac(lotAsset);
  const balancesBefore = {
    sellerPayment: await balance(seller.publicKey(), paymentAsset),
    sellerLot: await balance(seller.publicKey(), lotAsset),
    bidderPayment: await balance(bidder.publicKey(), paymentAsset),
    bidderLot: await balance(bidder.publicKey(), lotAsset),
  };
  const sellerClient = new SubRosaClient({
    rpcUrl: RPC_URL,
    networkPassphrase: NETWORK,
    contractId,
    secretKey: seller.secret(),
  });
  const bidderClient = new SubRosaClient({
    rpcUrl: RPC_URL,
    networkPassphrase: NETWORK,
    contractId,
    secretKey: bidder.secret(),
  });
  const drand = quicknet();
  const chain = await drand.chain().info();
  const now = Math.floor(Date.now() / 1000);
  const revealRound = Math.ceil((now + 30 - Number(chain.genesis_time)) / Number(chain.period)) + 1;
  const revealAt = drandRoundTime(revealRound, chain);
  const revealDeadline = revealAt + 35;
  const auditor = generateAuditorKeypair();
  const roundId = await createAssetAuctionRound(sellerClient, {
    itemRef: createHash("sha256").update("sub-rosa://pilot/atomic-srlot-auction").digest(),
    paymentAsset: paymentSac,
    lotAsset: lotSac,
    lotAmount: UNIT,
    fixedEscrow: 25n * UNIT,
    revealRound,
    commitDeadline: now + 15,
    revealDeadline,
    auditorPubkey: auditor.publicKey,
    maxParticipants: 5,
    eligibleParticipants: [bidder.publicKey()],
  });
  console.log(`created auction round ${roundId}; 1 SRLOT moved into contract custody`);

  const bid = 20n * UNIT;
  const escrow = 25n * UNIT;
  const sealed = await sealAssetBid({
    round: revealRound,
    drand,
    amount: bid,
    identity: new TextEncoder().encode(bidder.publicKey()),
    auditorPublicKey: auditor.publicKey,
  });
  await bidderClient.submitV2({ roundId, sealed, escrow });
  console.log("sealed 20 SRUSD bid committed with 25 SRUSD escrow");

  await waitUntil(revealAt);
  await sellerClient.openRevealV2(
    roundId,
    await fetchRoundSignature(drand, revealRound),
  );
  const storedSeal = await sellerClient.getSealV2(roundId, bidder.publicKey());
  if (!storedSeal) throw new Error("on-chain auction seal is missing");
  await sellerClient.revealV2({
    roundId,
    bidder: bidder.publicKey(),
    envelope: await openPayload(storedSeal.ciphertext, drand),
  });
  await waitUntil(revealDeadline);
  await clearAfterLedgerCatchup(sellerClient, roundId);
  await sellerClient.settleV2(roundId);

  const [round, policy, submission] = await Promise.all([
    sellerClient.getRoundV2(roundId),
    sellerClient.getRoundPolicyV2(roundId),
    sellerClient.getSubmissionV2(roundId, bidder.publicKey()),
  ]);
  const balancesAfter = {
    sellerPayment: await balance(seller.publicKey(), paymentAsset),
    sellerLot: await balance(seller.publicKey(), lotAsset),
    bidderPayment: await balance(bidder.publicKey(), paymentAsset),
    bidderLot: await balance(bidder.publicKey(), lotAsset),
  };
  if (
    round.mode.tag !== "Auction" ||
    round.status.tag !== "Settled" ||
    round.winner !== bidder.publicKey() ||
    round.winning_bid !== bid ||
    !submission.valid ||
    !submission.settled
  ) {
    throw new Error("atomic auction did not reach the expected settled state");
  }
  if (
    !policy ||
    policy.fixed_escrow !== escrow ||
    policy.eligible_participants[0] !== bidder.publicKey()
  ) {
    throw new Error("auction partner policy did not persist fixed escrow and eligibility");
  }
  const receipt = await sellerClient.exportReceiptV2(roundId);
  const verification = verifyReceiptV2(receipt);
  if (!verification.valid) {
    throw new Error(`auction receipt verification failed: ${JSON.stringify(verification.issues)}`);
  }
  if (
    balancesAfter.sellerPayment - balancesBefore.sellerPayment !== 20 ||
    balancesAfter.sellerLot - balancesBefore.sellerLot !== -1 ||
    balancesAfter.bidderPayment - balancesBefore.bidderPayment !== -20 ||
    balancesAfter.bidderLot - balancesBefore.bidderLot !== 1
  ) {
    throw new Error("classic asset balances do not match atomic settlement");
  }

  console.log("LIVE CORE V2 ATOMIC AUCTION PASSED");
  console.log(
    JSON.stringify({
      contractId,
      roundId: roundId.toString(),
      mode: round.mode.tag,
      status: round.status.tag,
      winner: round.winner,
      winningBid: round.winning_bid.toString(),
      paymentAsset: paymentSac,
      lotAsset: lotSac,
      lotAmount: round.lot_amount.toString(),
      policy: receipt.policy,
      receiptVerified: true,
      balanceDeltas: {
        sellerPayment: 20,
        sellerLot: -1,
        bidderPayment: -20,
        bidderLot: 1,
      },
    }),
  );
}

main().catch((error) => {
  console.error("LIVE CORE V2 ATOMIC AUCTION FAILED");
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
