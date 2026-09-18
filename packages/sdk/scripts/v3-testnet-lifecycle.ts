// Explicitly testnet-only live proof for the protocol-3 owner-triggered reveal.
// Runs two Auction rounds on a shared timeline against the deployed v3 contract:
//   R1 — owner opens the reveal window before fallback; an outsider (a bidder,
//        not the operator) is rejected before fallback; two bidders reveal; the
//        loser's escrow is refunded at settlement.
//   R2 — the owner never opens; after the fallback timestamp a non-operator
//        (the keeper) opens permissionlessly; the sole bidder reveals and wins.
// It proves: create_round_v3, owner authorization, outsider rejection,
// automatic fallback opening, reveal/clear/settle, Auction escrow/lot
// conservation, loser refund, and v3 receipt export/verification. It records
// per-operation fees and transaction hashes. It changes no SDK defaults and
// touches no existing contract. The void-after-VOID_GRACE (revealDeadline +
// 3600s) refund path is covered by the contract unit tests and is intentionally
// not exercised here because of its one-hour on-chain wait.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  Asset,
  BASE_FEE,
  Horizon,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  rpc,
  type xdr,
} from "@stellar/stellar-sdk";
import {
  drandRoundTime,
  fetchRoundSignature,
  generateAuditorKeypair,
  openPayload,
  quicknet,
} from "@sub-rosa/tlock";

import {
  assetAuctionRound,
  sealAssetBid,
  SubRosaClient,
  verifyReceiptV2,
  type CreateRoundV3Params,
} from "../src/index.js";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const DIR = resolve(ROOT, "artifacts/reveal-policy-v3/testnet");
const RPC_URL = "https://soroban-testnet.stellar.org";
const HORIZON_URL = "https://horizon-testnet.stellar.org";
const NETWORK = Networks.TESTNET;
const PAYMENT_CODE = "SRUSD";
const LOT_CODE = "SRLOT";
const UNIT = 10_000_000n; // 1.0 in 7-decimal stroops

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const nowSec = () => Math.floor(Date.now() / 1000);

async function waitUntil(timestamp: number): Promise<void> {
  while (nowSec() <= timestamp) {
    await sleep(Math.min(3_000, (timestamp + 1 - nowSec()) * 1_000));
  }
}

async function main() {
  if (!process.argv.includes("--run")) {
    throw new Error("Pass --run to execute live TESTNET lifecycle transactions");
  }
  const server = new rpc.Server(RPC_URL);
  assert.equal((await server.getNetwork()).passphrase, NETWORK);

  const deployment = JSON.parse(
    readFileSync(resolve(DIR, "deployment.json"), "utf8"),
  ) as { contractId: string; wasmHash: string; accounts: Record<string, string> };
  const contractId = deployment.contractId;
  console.log(`v3 testnet contract: ${contractId}`);

  // Load the four persisted testnet identities; generate + fund a fresh issuer.
  const accounts = JSON.parse(
    readFileSync(resolve(DIR, "accounts.local.json"), "utf8"),
  ) as Record<string, { publicKey: string; secretKey: string }>;
  const owner = Keypair.fromSecret(accounts.owner.secretKey); // seller / operator
  const bidder = Keypair.fromSecret(accounts.bidder.secretKey); // wins both rounds
  const loser = Keypair.fromSecret(accounts.loser.secretKey); // outbid in R1
  const keeper = Keypair.fromSecret(accounts.keeper.secretKey); // fallback opener

  const issuerPath = resolve(DIR, "issuer.local.json");
  const issuer = existsSync(issuerPath)
    ? Keypair.fromSecret(
        (JSON.parse(readFileSync(issuerPath, "utf8")) as { secretKey: string }).secretKey,
      )
    : Keypair.random();
  if (!existsSync(issuerPath)) {
    writeFileSync(
      issuerPath,
      JSON.stringify({ publicKey: issuer.publicKey(), secretKey: issuer.secret() }, null, 2),
      { mode: 0o600 },
    );
  }

  const horizon = new Horizon.Server(HORIZON_URL);
  async function ensureFunded(kp: Keypair, label: string) {
    const res = await fetch(`${HORIZON_URL}/accounts/${kp.publicKey()}`);
    if (res.status === 404) {
      const funded = await fetch(`https://friendbot.stellar.org/?addr=${kp.publicKey()}`);
      if (!funded.ok) throw new Error(`friendbot ${label} HTTP ${funded.status}`);
      console.log(`funded ${label}: ${kp.publicKey()}`);
    } else if (!res.ok) {
      throw new Error(`account lookup ${label} HTTP ${res.status}`);
    }
  }
  for (const [kp, label] of [
    [owner, "owner"], [bidder, "bidder"], [loser, "loser"], [keeper, "keeper"], [issuer, "issuer"],
  ] as const) {
    await ensureFunded(kp, label);
  }

  const paymentAsset = new Asset(PAYMENT_CODE, issuer.publicKey());
  const lotAsset = new Asset(LOT_CODE, issuer.publicKey());

  async function submit(source: Keypair, ...ops: xdr.Operation[]) {
    const account = await horizon.loadAccount(source.publicKey());
    const builder = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NETWORK });
    for (const op of ops) builder.addOperation(op);
    const tx = builder.setTimeout(120).build();
    tx.sign(source);
    await horizon.submitTransaction(tx);
  }
  async function hasTrustline(address: string, asset: Asset) {
    const account = await horizon.loadAccount(address);
    return account.balances.some(
      (b) => "asset_code" in b && b.asset_code === asset.code && b.asset_issuer === asset.issuer,
    );
  }
  async function assetBalance(address: string, asset: Asset): Promise<number> {
    const account = await horizon.loadAccount(address);
    const entry = account.balances.find(
      (b) => "asset_code" in b && b.asset_code === asset.code && b.asset_issuer === asset.issuer,
    );
    return entry ? Number(entry.balance) : 0;
  }
  async function xlmBalance(address: string): Promise<number> {
    const account = await horizon.loadAccount(address);
    const native = account.balances.find((b) => b.asset_type === "native");
    return native ? Number(native.balance) : 0;
  }

  // Trustlines: owner receives payment + holds/deposits the lot; bidder + loser
  // pay in the payment asset and can receive the lot.
  const trustlineTargets: Array<[Keypair, Asset]> = [
    [owner, paymentAsset], [owner, lotAsset],
    [bidder, paymentAsset], [bidder, lotAsset],
    [loser, paymentAsset], [loser, lotAsset],
  ];
  for (const [kp, asset] of trustlineTargets) {
    if (!(await hasTrustline(kp.publicKey(), asset))) {
      await submit(kp, Operation.changeTrust({ asset }));
    }
  }
  // Fund working balances from the issuer.
  await submit(
    issuer,
    Operation.payment({ destination: bidder.publicKey(), asset: paymentAsset, amount: "1000" }),
    Operation.payment({ destination: loser.publicKey(), asset: paymentAsset, amount: "1000" }),
    Operation.payment({ destination: owner.publicKey(), asset: lotAsset, amount: "2" }),
  );

  function deploySac(asset: Asset): string {
    const assetName = `${asset.code}:${asset.issuer}`;
    try {
      execFileSync(
        "stellar",
        ["contract", "asset", "deploy", "--asset", assetName, "--source-account", issuer.secret(),
          "--network", "testnet", "--quiet"],
        { stdio: "pipe" },
      );
    } catch {
      // Deterministic SAC may already exist from an earlier run.
    }
    return execFileSync(
      "stellar",
      ["contract", "id", "asset", "--asset", assetName, "--network", "testnet", "--quiet"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
  }
  const paymentSac = deploySac(paymentAsset);
  const lotSac = deploySac(lotAsset);
  console.log(`payment SAC ${paymentSac}`);
  console.log(`lot SAC     ${lotSac}`);

  const clientFor = (kp: Keypair) =>
    new SubRosaClient({ rpcUrl: RPC_URL, networkPassphrase: NETWORK, contractId, secretKey: kp.secret() });
  const ownerClient = clientFor(owner);
  const bidderClient = clientFor(bidder);
  const loserClient = clientFor(loser);
  const keeperClient = clientFor(keeper);
  assert.equal(await ownerClient.supportsRevealPolicy(), true);

  const roles = { owner, bidder, loser, keeper, issuer };
  const xlmBefore: Record<string, number> = {};
  for (const [name, kp] of Object.entries(roles)) xlmBefore[name] = await xlmBalance(kp.publicKey());
  const assetBefore = {
    ownerPayment: await assetBalance(owner.publicKey(), paymentAsset),
    ownerLot: await assetBalance(owner.publicKey(), lotAsset),
    bidderPayment: await assetBalance(bidder.publicKey(), paymentAsset),
    bidderLot: await assetBalance(bidder.publicKey(), lotAsset),
    loserPayment: await assetBalance(loser.publicKey(), paymentAsset),
    loserLot: await assetBalance(loser.publicKey(), lotAsset),
  };

  // Shared timeline. All setup is done, so anchor timing to "now" with generous
  // room for two creates + three commits before the commit deadline.
  const drand = quicknet();
  const chain = await drand.chain().info();
  const anchor = nowSec();
  const revealRound = Math.ceil((anchor + 100 - Number(chain.genesis_time)) / Number(chain.period)) + 1;
  const revealAt = drandRoundTime(revealRound, chain);
  const commitDeadline = anchor + 80;
  const fallbackAt = revealAt + 75; // > privacy_at; owner opens R1 before this
  const revealDeadline = fallbackAt + 300; // MIN_REVEAL_WINDOW
  assert.ok(commitDeadline < revealAt, "commit deadline must precede reveal round time");
  const auditor = generateAuditorKeypair();

  const ownerAddr = owner.publicKey();
  const bidderAddr = bidder.publicKey();
  const loserAddr = loser.publicKey();

  const commonV3 = {
    revealRound,
    commitDeadline,
    revealDeadline,
    auditorPubkey: auditor.publicKey,
    paymentAsset: paymentSac,
    lotAsset: lotSac,
    lotAmount: UNIT,
    fixedEscrow: 25n * UNIT,
    maxParticipants: 5,
  } as const;

  const v3Params = (itemRef: string, eligible: string[]): CreateRoundV3Params => ({
    ...assetAuctionRound({
      ...commonV3,
      itemRef: createHash("sha256").update(itemRef).digest(),
      eligibleParticipants: eligible,
    }),
    revealPolicy: { type: "owner-triggered", fallbackAt },
  });

  const round1 = await ownerClient.createRoundV3(
    v3Params("sub-rosa://v3/testnet/owner-open", [bidderAddr, loserAddr]),
  );
  const round2 = await ownerClient.createRoundV3(
    v3Params("sub-rosa://v3/testnet/fallback", [bidderAddr]),
  );
  console.log(`created owner-triggered auction rounds R1=${round1} R2=${round2}`);

  async function commit(client: SubRosaClient, roundId: bigint, who: Keypair, amount: bigint) {
    const sealed = await sealAssetBid({
      round: revealRound, drand, amount,
      identity: new TextEncoder().encode(who.publicKey()),
      auditorPublicKey: auditor.publicKey,
    });
    await client.submitV2({ roundId, sealed, escrow: 25n * UNIT });
  }
  await commit(bidderClient, round1, bidder, 20n * UNIT);
  await commit(loserClient, round1, loser, 15n * UNIT);
  await commit(bidderClient, round2, bidder, 20n * UNIT);
  console.log("committed sealed bids (R1: bidder 20 + loser 15; R2: bidder 20), 25 escrow each");

  await waitUntil(revealAt);
  const signature = await fetchRoundSignature(drand, revealRound);

  // --- R1: outsider rejection before fallback, then owner opens ---
  let outsiderRejected = false;
  try {
    await loserClient.openRevealV2(round1, signature); // loser is a bidder, not operator
    throw new Error("SECURITY: non-operator open_reveal_v2 was accepted before fallback");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith("SECURITY:")) throw error;
    outsiderRejected = true;
    console.log(`outsider open rejected before fallback: ${message.split("\n")[0]}`);
  }
  assert.equal(nowSec() < fallbackAt, true, "owner must open before fallback for the auth proof");
  await ownerClient.openRevealV2(round1, signature);
  const r1OwnerOpenHash = ownerClient.submittedTransactionHashes.at(-1)!;
  console.log(`R1 opened by owner (operator auth) tx=${r1OwnerOpenHash}`);

  for (const [client, who] of [[bidderClient, bidder], [loserClient, loser]] as const) {
    const seal = await client.getSealV2(round1, who.publicKey());
    if (!seal) throw new Error(`R1 seal missing for ${who.publicKey()}`);
    await client.revealV2({ roundId: round1, bidder: who.publicKey(), envelope: await openPayload(seal.ciphertext, drand) });
  }
  console.log("R1 both bids revealed");

  // --- R2: owner does NOT open; after fallback a non-operator opens ---
  await waitUntil(fallbackAt + 3);
  assert.equal(nowSec() >= fallbackAt, true);
  await keeperClient.openRevealV2(round2, signature); // permissionless after fallback
  const r2FallbackOpenHash = keeperClient.submittedTransactionHashes.at(-1)!;
  console.log(`R2 opened by keeper via automatic fallback tx=${r2FallbackOpenHash}`);
  {
    const seal = await bidderClient.getSealV2(round2, bidderAddr);
    if (!seal) throw new Error("R2 seal missing");
    await bidderClient.revealV2({ roundId: round2, bidder: bidderAddr, envelope: await openPayload(seal.ciphertext, drand) });
  }
  console.log("R2 bid revealed");

  // --- clear + settle both after the reveal deadline ---
  await waitUntil(revealDeadline);
  async function clearWhenReady(client: SubRosaClient, roundId: bigint) {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const preflight = await client.preflightClearV2(roundId);
      if (preflight.ok) return client.clearV2(roundId);
      if (!preflight.error.message.includes("#16")) throw preflight.error;
      await sleep(5_000);
    }
    throw new Error("ledger did not advance past reveal_deadline in time");
  }
  const r1Winner = await clearWhenReady(ownerClient, round1);
  await ownerClient.settleV2(round1);
  const r1SettleHash = ownerClient.submittedTransactionHashes.at(-1)!;
  const r2Winner = await clearWhenReady(ownerClient, round2);
  await ownerClient.settleV2(round2);
  console.log(`settled R1 (winner ${r1Winner}) and R2 (winner ${r2Winner})`);

  // --- assertions ---
  const [r1, r2, r1Reveal, r2Reveal, r1LoserSub] = await Promise.all([
    ownerClient.getRoundV2(round1),
    ownerClient.getRoundV2(round2),
    ownerClient.getRevealStateV3(round1),
    ownerClient.getRevealStateV3(round2),
    ownerClient.getSubmissionV2(round1, loserAddr),
  ]);
  assert.equal(r1.mode.tag, "Auction");
  assert.equal(r1.status.tag, "Settled");
  assert.equal(r1.winner, bidderAddr);
  assert.equal(r1.winning_bid, 20n * UNIT);
  assert.equal(r2.status.tag, "Settled");
  assert.equal(r2.winner, bidderAddr);
  assert.equal(r2.winning_bid, 20n * UNIT);
  assert.equal(r1Reveal.policy.tag, "OwnerTriggered");
  assert.equal(r2Reveal.policy.tag, "OwnerTriggered");
  assert.ok(r1LoserSub.valid && r1LoserSub.settled, "loser submission should be valid + settled");

  const assetAfter = {
    ownerPayment: await assetBalance(owner.publicKey(), paymentAsset),
    ownerLot: await assetBalance(owner.publicKey(), lotAsset),
    bidderPayment: await assetBalance(bidder.publicKey(), paymentAsset),
    bidderLot: await assetBalance(bidder.publicKey(), lotAsset),
    loserPayment: await assetBalance(loser.publicKey(), paymentAsset),
    loserLot: await assetBalance(loser.publicKey(), lotAsset),
  };
  const deltas = {
    ownerPayment: assetAfter.ownerPayment - assetBefore.ownerPayment, // +40 (20+20)
    ownerLot: assetAfter.ownerLot - assetBefore.ownerLot, // -2
    bidderPayment: assetAfter.bidderPayment - assetBefore.bidderPayment, // -40
    bidderLot: assetAfter.bidderLot - assetBefore.bidderLot, // +2
    loserPayment: assetAfter.loserPayment - assetBefore.loserPayment, // 0 (escrow refunded)
    loserLot: assetAfter.loserLot - assetBefore.loserLot, // 0
  };
  assert.equal(deltas.ownerPayment, 40, "seller should receive both winning bids");
  assert.equal(deltas.ownerLot, -2, "seller should transfer both lots");
  assert.equal(deltas.bidderPayment, -40, "winner should pay both winning bids only");
  assert.equal(deltas.bidderLot, 2, "winner should receive both lots");
  assert.equal(deltas.loserPayment, 0, "loser escrow must be fully refunded");
  assert.equal(deltas.loserLot, 0, "loser must not receive a lot");

  for (const roundId of [round1, round2]) {
    const receipt = await ownerClient.exportReceiptV2(roundId);
    const verification = verifyReceiptV2(receipt);
    if (!verification.valid) {
      throw new Error(`receipt ${roundId} verification failed: ${JSON.stringify(verification.issues)}`);
    }
    assert.equal(receipt.version, 3, `receipt ${roundId} should export as v3`);
  }

  // --- fee + resource evidence for the key v3 operations ---
  async function feeFor(hash: string) {
    const result = await server.getTransaction(hash);
    return result.status === "SUCCESS"
      ? { hash, ledger: result.ledger, feeCharged: result.resultXdr.feeCharged().toString() }
      : { hash, status: result.status };
  }
  const xlmAfter: Record<string, number> = {};
  for (const [name, kp] of Object.entries(roles)) xlmAfter[name] = await xlmBalance(kp.publicKey());
  const xlmFees = Object.fromEntries(
    Object.keys(roles).map((name) => [name, Number((xlmBefore[name] - xlmAfter[name]).toFixed(7))]),
  );

  const evidence = {
    network: "testnet",
    contractId,
    wasmHash: deployment.wasmHash,
    ranAt: new Date().toISOString(),
    drand: { revealRound, revealAt, fallbackAt, revealDeadline, beaconChain: chain.hash },
    assets: { paymentSac, lotSac, issuer: issuer.publicKey() },
    rounds: {
      r1: { id: round1.toString(), scenario: "owner-open + outsider-rejection + loser-refund",
        winner: r1.winner, winningBid: r1.winning_bid.toString(), status: r1.status.tag,
        outsiderRejected, ownerOpenTx: r1OwnerOpenHash, settleTx: r1SettleHash,
        revealPolicy: r1Reveal.policy.tag },
      r2: { id: round2.toString(), scenario: "automatic fallback open by non-operator",
        winner: r2.winner, winningBid: r2.winning_bid.toString(), status: r2.status.tag,
        fallbackOpenTx: r2FallbackOpenHash, revealPolicy: r2Reveal.policy.tag },
    },
    assetDeltas: deltas,
    keyOperationFees: {
      r1OwnerOpen: await feeFor(r1OwnerOpenHash),
      r2FallbackOpen: await feeFor(r2FallbackOpenHash),
      r1Settle: await feeFor(r1SettleHash),
    },
    xlmFeeSpendByRole: xlmFees,
    transactionHashes: {
      owner: [...ownerClient.submittedTransactionHashes],
      bidder: [...bidderClient.submittedTransactionHashes],
      loser: [...loserClient.submittedTransactionHashes],
      keeper: [...keeperClient.submittedTransactionHashes],
    },
    explorer: `https://stellar.expert/explorer/testnet/contract/${contractId}`,
  };
  mkdirSync(DIR, { recursive: true });
  writeFileSync(resolve(DIR, "lifecycle.json"), JSON.stringify(evidence, null, 2) + "\n");
  console.log("TESTNET V3 LIFECYCLE PASSED");
  console.log(JSON.stringify(evidence, null, 2));
}

main().catch((error) => {
  console.error("TESTNET V3 LIFECYCLE FAILED");
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
