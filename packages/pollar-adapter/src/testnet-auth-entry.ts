import type { PollarClient } from "@pollar/core";
import {
  Address,
  BASE_FEE,
  Contract,
  FeeBumpTransaction,
  Keypair,
  Networks,
  Operation,
  Transaction,
  TransactionBuilder,
  authorizeEntry,
  hash,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";
import {
  SUB_ROSA_DEPLOYMENTS,
  drandRoundTime,
  generateAuditorKeypair,
  quicknet,
} from "@sub-rosa/sdk";

import { createPollarSubRosaSigner } from "./index.js";

export type PollarAuthEntryStage =
  | "preflight"
  | "fund_sponsor"
  | "setup_signer"
  | "read_ledger"
  | "load_drand"
  | "create_auditor"
  | "create_contract"
  | "build_auth_entry"
  | "sign_auth_entry"
  | "verify_auth_entry"
  | "submit"
  | "complete";

export interface PollarAuthEntryProgress {
  stage: PollarAuthEntryStage;
  message: string;
}

export interface PollarAuthEntryTestOptions {
  rpcUrl?: string;
  friendbotUrl?: string;
  onProgress?: (progress: PollarAuthEntryProgress) => void;
}

export interface PollarAuthEntryEvidence {
  evidenceVersion: 1;
  generatedAt: string;
  network: "testnet";
  wallet: string;
  sponsor: string;
  contractId: string;
  function: "create_partner_round_v2";
  roundId: string;
  latestLedgerAtSigning: number;
  validUntilLedger: number;
  signerVerified: true;
  invocationVerified: true;
  envelopeSignerVerified: true;
  enforcedSimulationVerified: true;
  authNonce: string;
  transaction: {
    hash: string;
    status: "SUCCESS";
    ledger: number;
    sequence: string;
    fee: string;
    submittedAtLedger: number;
    explorerUrl: string;
  };
}

export interface PollarAuthEntryRpcResult {
  status: rpc.Api.SendTransactionStatus;
  hash: string;
  latestLedger: number;
  latestLedgerCloseTime: number;
  errorResultXdr?: string;
  errorResultCode?: string;
  operationResultCodes?: string[];
  diagnosticEventsXdr?: string[];
  diagnosticEventsDecoded?: string[];
}

export class PollarAuthEntrySubmissionError extends Error {
  readonly name = "PollarAuthEntrySubmissionError";
  readonly code = "STELLAR_RPC_REJECTED";

  constructor(readonly rpcResult: PollarAuthEntryRpcResult) {
    const decoded = [rpcResult.errorResultCode, ...(rpcResult.operationResultCodes ?? [])]
      .filter(Boolean)
      .join(" / ");
    super(
      `Stellar RPC rejected the fresh signed auth-entry transaction: status=${rpcResult.status}, ` +
      `hash=${rpcResult.hash}, decoded=${decoded || "unavailable"}`,
    );
  }
}

const DEFAULT_RPC_URL = "https://soroban-testnet.stellar.org";
const DEFAULT_FRIENDBOT_URL = "https://friendbot.stellar.org";
const AUTH_ENTRY_TTL = 80;
const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function requireAuthenticatedClassicWallet(pollar: PollarClient): string {
  if (pollar.getNetwork() !== "testnet") throw new Error("Pollar must be configured for testnet");
  const auth = pollar.getAuthState();
  if (auth.step !== "authenticated" || !auth.verified) {
    throw new Error("Pollar session must be authenticated and server-verified");
  }
  const wallet = pollar.getWallet();
  if (!wallet) throw new Error("Pollar has no authenticated Stellar wallet");
  if (wallet.custody === "smart" || !wallet.address.startsWith("G")) {
    throw new Error("Live signAuthEntry verification requires a classic Pollar G-address wallet");
  }
  if (wallet.provisioning !== undefined && wallet.provisioning !== "READY") {
    throw new Error(`Pollar wallet provisioning is ${wallet.provisioning}; wait for READY`);
  }
  if (wallet.existsOnStellar === false) {
    throw new Error("The Pollar G-address is not present on Stellar testnet");
  }
  return wallet.address;
}

async function fundEphemeralSponsor(address: string, friendbotUrl: string): Promise<void> {
  const url = new URL(friendbotUrl);
  url.searchParams.set("addr", address);
  const response = await fetch(url, { method: "GET" });
  if (!response.ok) {
    throw new Error(`Friendbot could not fund the ephemeral testnet sponsor (HTTP ${response.status})`);
  }
}

async function sha256Bytes(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

async function latestLedgerSequence(rpcUrl: string): Promise<number> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getLatestLedger", params: {} }),
  });
  if (!response.ok) throw new Error(`Stellar RPC returned HTTP ${response.status}`);
  const payload = await response.json() as {
    result?: { sequence?: unknown };
    error?: { message?: string };
  };
  const sequence = payload.result?.sequence;
  if (!Number.isSafeInteger(sequence) || (sequence as number) <= 0) {
    throw new Error(payload.error?.message ?? "Stellar RPC returned an invalid latest ledger sequence");
  }
  return sequence as number;
}

function sponsorSigner(sponsor: Keypair) {
  return async (unsignedXdr: string, options?: { networkPassphrase?: string; address?: string }) => {
    if (options?.networkPassphrase !== undefined && options.networkPassphrase !== Networks.TESTNET) {
      throw new Error("Ephemeral sponsor refused a non-testnet transaction");
    }
    if (options?.address !== undefined && options.address !== sponsor.publicKey()) {
      throw new Error("Ephemeral sponsor refused a different transaction source");
    }
    const parsed = TransactionBuilder.fromXDR(unsignedXdr, Networks.TESTNET);
    if (parsed instanceof FeeBumpTransaction || !(parsed instanceof Transaction)) {
      throw new Error("Ephemeral sponsor requires a classic non-fee-bump transaction");
    }
    if (parsed.source !== sponsor.publicKey() || parsed.signatures.length !== 0) {
      throw new Error("Ephemeral sponsor transaction source/signature preflight failed");
    }
    parsed.sign(sponsor);
    return { signedTxXdr: parsed.toXDR(), signerAddress: sponsor.publicKey() };
  };
}

function addressAuthEntry(
  entries: xdr.SorobanAuthorizationEntry[] | undefined,
  wallet: string,
): xdr.SorobanAuthorizationEntry {
  const entry = entries?.find((candidate) => {
    if (candidate.credentials().switch().name !== "sorobanCredentialsAddress") return false;
    return Address.fromScAddress(candidate.credentials().address().address()).toString() === wallet;
  });
  if (!entry) throw new Error("Signed Pollar authorization entry is missing from the transaction");
  return entry;
}

function struct(entries: Record<string, xdr.ScVal>): xdr.ScVal {
  return xdr.ScVal.scvMap(
    Object.entries(entries)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, val]) => new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(key), val })),
  );
}

function unitEnum(name: string): xdr.ScVal {
  return xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(name)]);
}

export function decodePollarTransactionResult(errorResultXdr: string): {
  errorResultCode: string;
  operationResultCodes?: string[];
} {
  const decoded = xdr.TransactionResult.fromXDR(errorResultXdr, "base64");
  const result = decoded.result();
  const errorResultCode = result.switch().name;
  if (errorResultCode !== "txFailed" && errorResultCode !== "txSuccess") {
    return { errorResultCode };
  }
  const operationResultCodes = result.results().map((operation) => {
    const operationCode = operation.switch().name;
    if (operationCode !== "opInner") return operationCode;
    const inner = operation.tr();
    const innerCode = inner.switch().name;
    if (innerCode !== "invokeHostFunction") return `${operationCode}:${innerCode}`;
    return `${operationCode}:${innerCode}:${inner.invokeHostFunctionResult().switch().name}`;
  });
  return { errorResultCode, operationResultCodes };
}

function jsonDiagnostic(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    typeof item === "bigint" ? item.toString() : item,
  );
}

function decodeDiagnosticEvent(eventXdr: string): string {
  try {
    const diagnostic = xdr.DiagnosticEvent.fromXDR(eventXdr, "base64");
    const event = diagnostic.event();
    const body = event.body().v0();
    return jsonDiagnostic({
      inSuccessfulContractCall: diagnostic.inSuccessfulContractCall(),
      eventType: event.type().name,
      topics: body.topics().map((topic) => scValToNative(topic) as unknown),
      data: scValToNative(body.data()) as unknown,
    });
  } catch (error) {
    return `diagnostic decode failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function sanitizeRpcResult(raw: rpc.Api.RawSendTransactionResponse): PollarAuthEntryRpcResult {
  let decoded: ReturnType<typeof decodePollarTransactionResult> | undefined;
  if (raw.errorResultXdr) {
    try {
      decoded = decodePollarTransactionResult(raw.errorResultXdr);
    } catch {
      decoded = { errorResultCode: "errorResultXdr decode failed" };
    }
  }
  return {
    status: raw.status,
    hash: raw.hash,
    latestLedger: raw.latestLedger,
    latestLedgerCloseTime: raw.latestLedgerCloseTime,
    ...(raw.errorResultXdr ? { errorResultXdr: raw.errorResultXdr } : {}),
    ...decoded,
    ...(raw.diagnosticEventsXdr && raw.diagnosticEventsXdr.length > 0
      ? {
          diagnosticEventsXdr: raw.diagnosticEventsXdr,
          diagnosticEventsDecoded: raw.diagnosticEventsXdr.map(decodeDiagnosticEvent),
        }
      : {}),
  };
}

async function waitForSuccess(
  server: rpc.Server,
  transactionHash: string,
): Promise<rpc.Api.GetSuccessfulTransactionResponse> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const result = await server.getTransaction(transactionHash);
    if (result.status === "SUCCESS") return result;
    if (result.status === "FAILED") {
      throw new Error(`Auth-entry transaction ${transactionHash} failed on Stellar testnet`);
    }
    await sleep(1_500);
  }
  throw new Error(`Timed out waiting for auth-entry transaction ${transactionHash}`);
}

function verifyAuthEntry(
  entry: xdr.SorobanAuthorizationEntry,
  wallet: string,
  contractId: string,
  expectedExpiration: number,
): string {
  const credentials = entry.credentials();
  if (credentials.switch().name !== "sorobanCredentialsAddress") {
    throw new Error("Pollar authorization did not use address credentials");
  }
  const addressCredentials = credentials.address();
  if (Address.fromScAddress(addressCredentials.address()).toString() !== wallet) {
    throw new Error("Pollar authorization signer address changed");
  }
  if (addressCredentials.signatureExpirationLedger() !== expectedExpiration) {
    throw new Error("Pollar authorization expiration changed after signing");
  }
  const invocation = entry.rootInvocation();
  if (invocation.function().switch().name !== "sorobanAuthorizedFunctionTypeContractFn") {
    throw new Error("Pollar authorization invocation is not a contract function");
  }
  const contractFunction = invocation.function().contractFn();
  if (
    Address.fromScAddress(contractFunction.contractAddress()).toString() !== contractId ||
    contractFunction.functionName().toString() !== "create_partner_round_v2"
  ) {
    throw new Error("Pollar authorization invocation target changed");
  }
  const signatures = scValToNative(addressCredentials.signature()) as unknown;
  if (!Array.isArray(signatures) || signatures.length !== 1) {
    throw new Error("Pollar authorization signature has an unsupported shape");
  }
  const record = signatures[0] as Record<string, unknown>;
  const publicKey = Buffer.from(record.public_key as Uint8Array);
  const signature = Buffer.from(record.signature as Uint8Array);
  const preimage = xdr.HashIdPreimage.envelopeTypeSorobanAuthorization(
    new xdr.HashIdPreimageSorobanAuthorization({
      networkId: hash(Buffer.from(Networks.TESTNET)),
      nonce: addressCredentials.nonce(),
      signatureExpirationLedger: addressCredentials.signatureExpirationLedger(),
      invocation,
    }),
  );
  if (
    publicKey.length !== 32 ||
    signature.length !== 64 ||
    !publicKey.equals(Address.fromString(wallet).toScAddress().accountId().ed25519()) ||
    !Keypair.fromPublicKey(wallet).verify(hash(preimage.toXDR()), signature)
  ) {
    throw new Error("Pollar authorization entry has an invalid Ed25519 signature");
  }
  return addressCredentials.nonce().toString();
}

function verifyPreparedTransaction(
  transaction: Transaction,
  sponsor: string,
  wallet: string,
  authorization: xdr.SorobanAuthorizationEntry,
): void {
  if (transaction.source !== sponsor || transaction.signatures.length !== 0) {
    throw new Error("Fresh prepared transaction source/signature state is invalid");
  }
  if (transaction.operations.length !== 1 || transaction.operations[0]?.type !== "invokeHostFunction") {
    throw new Error("Fresh prepared transaction must contain one invokeHostFunction operation");
  }
  const included = addressAuthEntry(transaction.operations[0].auth, wallet);
  if (!included.toXDR().equals(authorization.toXDR())) {
    throw new Error("Fresh prepared transaction does not contain the verified Pollar auth entry");
  }
  if (!transaction.toEnvelope().v1().tx().ext().value()) {
    throw new Error("Fresh prepared transaction is missing simulated Soroban transaction data");
  }
}

function verifyEnvelopeSignature(transaction: Transaction, sponsor: string): void {
  if (
    transaction.source !== sponsor ||
    !transaction.signatures.some((signature) =>
      Keypair.fromPublicKey(sponsor).verify(transaction.hash(), signature.signature()),
    )
  ) {
    throw new Error("Final transaction envelope is not signed by the ephemeral fee sponsor");
  }
}

export async function runPollarAuthEntryTestnet(
  pollar: PollarClient,
  options: PollarAuthEntryTestOptions = {},
): Promise<PollarAuthEntryEvidence> {
  await pollar.ready();
  const wallet = requireAuthenticatedClassicWallet(pollar);
  const rpcUrl = options.rpcUrl ?? DEFAULT_RPC_URL;
  const progress = (stage: PollarAuthEntryStage, message: string) =>
    options.onProgress?.({ stage, message });
  const server = new rpc.Server(rpcUrl);
  const network = await server.getNetwork();
  if (network.passphrase !== Networks.TESTNET) throw new Error("Configured RPC is not Stellar testnet");

  progress("preflight", "Creating an in-memory testnet sponsor; no secret is logged or exported");
  const sponsor = Keypair.random();
  progress("fund_sponsor", "Funding the ephemeral fee sponsor with Friendbot testnet XLM");
  await fundEphemeralSponsor(sponsor.publicKey(), options.friendbotUrl ?? DEFAULT_FRIENDBOT_URL);

  progress("setup_signer", "Binding the authenticated Pollar wallet to the adapter callback");
  const signer = createPollarSubRosaSigner({ pollar, rpcUrl, authEntryLedgerTtl: 100 });
  if (signer.publicKey !== wallet) throw new Error("Pollar wallet changed during auth-entry setup");
  progress("read_ledger", "Reading the current Stellar testnet ledger");
  const latestLedgerAtSigning = await latestLedgerSequence(rpcUrl);
  const validUntilLedger = latestLedgerAtSigning + AUTH_ENTRY_TTL;
  progress("load_drand", "Deriving a valid Sub Rosa testnet reveal window");
  const drand = quicknet();
  const chain = await drand.chain().info();
  const now = Math.floor(Date.now() / 1_000);
  const revealTarget = now + 360;
  const revealRound = Math.ceil((revealTarget - Number(chain.genesis_time)) / Number(chain.period)) + 1;
  const revealAt = drandRoundTime(revealRound, chain);
  progress("create_auditor", "Generating an in-memory public auditor key for the test round");
  const auditor = generateAuditorKeypair();
  const contractId = SUB_ROSA_DEPLOYMENTS.testnet.contractId;
  progress("create_contract", "Creating the low-level Sub Rosa contract invocation builder");
  const contract = new Contract(contractId);

  progress("build_auth_entry", "Simulating a Sub Rosa round creation with Pollar as non-source operator");
  const source = await server.getAccount(sponsor.publicKey());
  const policy = struct({
    eligible_participants: xdr.ScVal.scvVec([Address.fromString(wallet).toScVal()]),
    fixed_escrow: nativeToScVal(0n, { type: "i128" }),
    settlement: struct({
      lot_amount: nativeToScVal(0n, { type: "i128" }),
      lot_asset: xdr.ScVal.scvVoid(),
      mode: unitEnum("ReceiptOnly"),
      payment_asset: xdr.ScVal.scvVoid(),
    }),
  });
  const raw = new TransactionBuilder(source, {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(contract.call(
      "create_partner_round_v2",
      Address.fromString(wallet).toScVal(),
      nativeToScVal(await sha256Bytes(`sub-rosa://pollar-auth-entry/${Date.now()}`), { type: "bytes" }),
      nativeToScVal(await sha256Bytes("sub-rosa://schema/pollar-auth-entry-v1"), { type: "bytes" }),
      policy,
      nativeToScVal(BigInt(revealRound), { type: "u64" }),
      unitEnum("LowestBid"),
      nativeToScVal(BigInt(now + 300), { type: "u64" }),
      nativeToScVal(BigInt(revealAt + 300), { type: "u64" }),
      nativeToScVal(auditor.publicKey, { type: "bytes" }),
      nativeToScVal(1, { type: "u32" }),
    ))
    .setTimeout(300)
    .build();
  const simulation = await server.simulateTransaction(raw);
  if (!rpc.Api.isSimulationSuccess(simulation)) {
    throw new Error(`Sub Rosa auth-entry simulation failed: ${"error" in simulation ? simulation.error : "unknown RPC response"}`);
  }
  const assembled = rpc.assembleTransaction(raw, simulation).build();
  const invoke = assembled.operations[0];
  if (!invoke || invoke.type !== "invokeHostFunction") {
    throw new Error("Assembled test transaction has no invokeHostFunction operation");
  }
  const unsignedAuthorization = addressAuthEntry(invoke.auth, wallet);

  progress("sign_auth_entry", "Requesting the real Pollar signAuthEntry signature");
  const authorization = await authorizeEntry(
    unsignedAuthorization,
    async (preimage) => {
      const result = await signer.signAuthEntry(preimage.toXDR("base64"), {
        address: wallet,
        networkPassphrase: Networks.TESTNET,
      });
      if (result.signerAddress !== wallet) {
        throw new Error("Pollar auth-entry callback returned a different signer address");
      }
      return {
        publicKey: wallet,
        signature: Buffer.from(result.signedAuthEntry, "base64"),
      };
    },
    validUntilLedger,
    Networks.TESTNET,
  );

  progress("verify_auth_entry", "Verifying signer, invocation, network and expiration before submission");
  const authNonce = verifyAuthEntry(authorization, wallet, contractId, validUntilLedger);
  const latestAfterSigning = await latestLedgerSequence(rpcUrl);
  if (validUntilLedger <= latestAfterSigning) {
    throw new Error("Pollar authorization expired before transaction submission");
  }

  progress("submit", "Refreshing sequence, resources, footprint and fee with the signed auth entry");
  const freshSource = await server.getAccount(sponsor.publicKey());
  const authorizedRaw = new TransactionBuilder(freshSource, {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.invokeHostFunction({
      source: invoke.source,
      func: invoke.func,
      auth: (invoke.auth ?? []).map((entry) =>
        entry === unsignedAuthorization ? authorization : entry,
      ),
    }))
    .setTimeout(180)
    .build();
  const enforcedSimulation = await server.simulateTransaction(
    authorizedRaw,
    undefined,
    "enforce",
  );
  if (!rpc.Api.isSimulationSuccess(enforcedSimulation)) {
    const details = "error" in enforcedSimulation
      ? enforcedSimulation.error
      : "unknown enforce-mode RPC response";
    throw new Error(`Signed Pollar authorization failed fresh enforce-mode simulation: ${details}`);
  }
  const ready = rpc.assembleTransaction(authorizedRaw, enforcedSimulation).build();
  verifyPreparedTransaction(ready, sponsor.publicKey(), wallet, authorization);
  const latestBeforeSubmit = await latestLedgerSequence(rpcUrl);
  if (validUntilLedger <= latestBeforeSubmit) {
    throw new Error("Pollar authorization expired while preparing the fresh transaction");
  }
  const signed = await sponsorSigner(sponsor)(ready.toXDR(), {
    address: sponsor.publicKey(),
    networkPassphrase: Networks.TESTNET,
  });
  const signedTransaction = TransactionBuilder.fromXDR(signed.signedTxXdr, Networks.TESTNET);
  if (!(signedTransaction instanceof Transaction)) throw new Error("Sponsor returned an invalid transaction type");
  verifyEnvelopeSignature(signedTransaction, sponsor.publicKey());
  const submittedRaw = await server._sendTransaction(signedTransaction);
  const submitted = sanitizeRpcResult(submittedRaw);
  if (submitted.status === "ERROR" || submitted.status === "TRY_AGAIN_LATER") {
    throw new PollarAuthEntrySubmissionError(submitted);
  }
  const transactionHash = submitted.hash;
  const onChain = await waitForSuccess(server, transactionHash);
  if (!onChain.returnValue) throw new Error("Successful auth-entry transaction has no round id return value");
  const roundId = scValToNative(onChain.returnValue) as unknown;
  if (typeof roundId !== "bigint") throw new Error("Auth-entry transaction returned an invalid round id");

  progress("complete", "Live Pollar signAuthEntry signature and on-chain invocation succeeded");
  return {
    evidenceVersion: 1,
    generatedAt: new Date().toISOString(),
    network: "testnet",
    wallet,
    sponsor: sponsor.publicKey(),
    contractId,
    function: "create_partner_round_v2",
    roundId: roundId.toString(),
    latestLedgerAtSigning,
    validUntilLedger,
    signerVerified: true,
    invocationVerified: true,
    envelopeSignerVerified: true,
    enforcedSimulationVerified: true,
    authNonce,
    transaction: {
      hash: transactionHash,
      status: onChain.status,
      ledger: onChain.ledger,
      sequence: signedTransaction.sequence,
      fee: signedTransaction.fee,
      submittedAtLedger: submitted.latestLedger,
      explorerUrl: `https://stellar.expert/explorer/testnet/tx/${transactionHash}`,
    },
  };
}
