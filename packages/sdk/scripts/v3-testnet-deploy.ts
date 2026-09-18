// Explicitly testnet-only; saves public deployment evidence and private local
// test identities separately. Does not change SDK defaults or existing contracts.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BASE_FEE, Keypair, Networks, Operation, TransactionBuilder, rpc } from "@stellar/stellar-sdk";
import { basicNodeSigner } from "@stellar/stellar-sdk/contract";
import { RoundContract, SubRosaClient, fetchContractWasmHash, nativeXlmSacId } from "../src/index.js";
import { getChainInfo, getBeacon } from "../../../services/drand-tools/src/quicknet.js";
import { detectMessageVariant, DST } from "../../../services/drand-tools/src/parity.js";
import { pubkeyToSoroban, negatedG2Generator } from "../../../services/drand-tools/src/encode.js";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const DIR = resolve(ROOT, "artifacts/reveal-policy-v3/testnet");
const RPC = "https://soroban-testnet.stellar.org";
const NETWORK = Networks.TESTNET;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  if (!process.argv.includes("--deploy")) throw new Error("Pass --deploy to deploy to Stellar TESTNET only");
  const release = JSON.parse(readFileSync(resolve(ROOT, "artifacts/reveal-policy-v3/release.json"), "utf8"));
  const wasm = readFileSync(resolve(ROOT, release.wasm));
  assert.equal(createHash("sha256").update(wasm).digest("hex"), release.sha256);
  const server = new rpc.Server(RPC);
  assert.equal((await server.getNetwork()).passphrase, NETWORK);
  mkdirSync(DIR, { recursive: true, mode: 0o700 });
  const accountsPath = resolve(DIR, "accounts.local.json");
  if (!existsSync(accountsPath)) {
    const identities = Object.fromEntries(["owner", "bidder", "loser", "keeper"].map(role => {
      const key = Keypair.random();
      return [role, { publicKey: key.publicKey(), secretKey: key.secret() }];
    }));
    writeFileSync(accountsPath, JSON.stringify(identities, null, 2), { mode: 0o600, flag: "wx" });
  }
  const accounts = JSON.parse(readFileSync(accountsPath, "utf8")) as Record<string, { publicKey: string; secretKey: string }>;
  for (const [role, account] of Object.entries(accounts)) {
    const response = await fetch(`https://horizon-testnet.stellar.org/accounts/${account.publicKey}`);
    if (response.status === 404) {
      const funded = await fetch(`https://friendbot.stellar.org/?addr=${account.publicKey}`);
      if (!funded.ok) throw new Error(`Friendbot ${role} HTTP ${funded.status}`);
      console.log(`Funded testnet ${role}: ${account.publicKey}`);
    } else if (!response.ok) throw new Error(`Account lookup HTTP ${response.status}`);
    await server.getAccount(account.publicKey);
  }
  const owner = Keypair.fromSecret(accounts.owner.secretKey);
  const artifactPath = resolve(DIR, "deployment.json");
  const artifact: Record<string, any> = existsSync(artifactPath)
    ? JSON.parse(readFileSync(artifactPath, "utf8"))
    : { protocolVersion: 3, lifecycleApiVersion: 2, network: "testnet", networkPassphrase: NETWORK,
        rpcUrl: RPC, wasmHash: release.sha256, wasmBytes: wasm.length,
        accounts: Object.fromEntries(Object.entries(accounts).map(([role, value]) => [role, value.publicKey])), transactions: [] };
  assert.equal(artifact.wasmHash, release.sha256);
  assert.equal(artifact.networkPassphrase, NETWORK);
  const save = () => writeFileSync(artifactPath, JSON.stringify(artifact, null, 2) + "\n");
  async function confirmed(label: string, hash: string) {
    for (let i = 0; i < 60; i++) {
      const result = await server.getTransaction(hash);
      if (result.status === "SUCCESS") {
        const evidence = { label, hash, ledger: result.ledger, feeStroops: result.resultXdr.feeCharged().toString() };
        artifact.transactions.push(evidence);
        save();
        console.log(JSON.stringify(evidence));
        return;
      }
      if (result.status === "FAILED") throw new Error(`${label} transaction failed: ${hash}`);
      await sleep(2000);
    }
    throw new Error(`${label} confirmation timeout: ${hash}; check before retrying`);
  }

  if (!artifact.transactions.some((tx: any) => tx.label === "upload")) {
    const tx = new TransactionBuilder(await server.getAccount(owner.publicKey()), { fee: BASE_FEE, networkPassphrase: NETWORK })
      .addOperation(Operation.uploadContractWasm({ wasm })).setTimeout(180).build();
    const prepared = await server.prepareTransaction(tx);
    prepared.sign(owner);
    artifact.pendingUpload = prepared.hash().toString("hex");
    save();
    const submitted = await server.sendTransaction(prepared);
    if (submitted.status === "ERROR") throw new Error("WASM upload rejected by testnet RPC");
    await confirmed("upload", submitted.hash);
  }

  const info = await getChainInfo();
  assert.equal(info.hash, "52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971");
  assert.equal(info.schemeID, "bls-unchained-g1-rfc9380");
  const beacon = await getBeacon("latest");
  assert.equal(detectMessageVariant(beacon.round, beacon.signature, info.public_key), "sha256(be8)");
  const config = {
    drand_pubkey: Buffer.from(pubkeyToSoroban(info.public_key, "c1c0")),
    g2_neg_generator: Buffer.from(negatedG2Generator("c1c0")),
    dst: Buffer.from(DST), drand_genesis: BigInt(info.genesis_time), drand_period: BigInt(info.period),
    usdc: nativeXlmSacId(NETWORK),
  };
  if (!artifact.contractId) {
    const signer = basicNodeSigner(owner, NETWORK);
    const tx = await RoundContract.deploy(config, { wasmHash: release.sha256, rpcUrl: RPC,
      networkPassphrase: NETWORK, publicKey: owner.publicKey(),
      signTransaction: signer.signTransaction, signAuthEntry: signer.signAuthEntry });
    const sent = await tx.signAndSend();
    artifact.contractId = sent.result.options.contractId;
    artifact.deployedAt = new Date().toISOString();
    save();
    if (!sent.sendTransactionResponse?.hash) throw new Error("Missing deployment transaction hash");
    await confirmed("deploy", sent.sendTransactionResponse.hash);
  }
  assert.equal(await fetchContractWasmHash(server, artifact.contractId), release.sha256);
  const client = new SubRosaClient({ rpcUrl: RPC, networkPassphrase: NETWORK,
    contractId: artifact.contractId, publicKey: owner.publicKey() });
  assert.equal(await client.supportsRevealPolicy(), true);
  const actual = await client.getConfig();
  assert.deepEqual(actual.drand_pubkey, config.drand_pubkey);
  assert.deepEqual(actual.g2_neg_generator, config.g2_neg_generator);
  assert.deepEqual(actual.dst, config.dst);
  assert.equal(actual.drand_genesis, config.drand_genesis);
  assert.equal(actual.drand_period, config.drand_period);
  assert.equal(actual.usdc, config.usdc);
  artifact.verifiedAt = new Date().toISOString();
  artifact.verified = { wasmHash: true, capability: 3, constructor: true, drandBeaconRound: beacon.round };
  artifact.explorer = `https://stellar.expert/explorer/testnet/contract/${artifact.contractId}`;
  save();
  console.log("TESTNET V3 DEPLOYMENT VERIFIED");
  console.log(JSON.stringify(artifact, null, 2));
}
main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
