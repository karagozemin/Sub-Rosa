import type { PollarClient } from "@pollar/core";
import {
  Address,
  FeeBumpTransaction,
  Keypair,
  Networks,
  StrKey,
  Transaction,
  TransactionBuilder,
  rpc,
  xdr,
} from "@stellar/stellar-sdk";
import type {
  SignAuthEntry,
  SignTransaction,
} from "@stellar/stellar-sdk/contract";
import {
  SubRosaClient,
  type CommitV2Params,
  type CreatePartnerRoundV2Params,
  type CreateRoundParams,
  type CreateRoundV2Params,
  type CreateRoundV3Params,
  type RevealV2Params,
  type SubRosaClientConfig,
} from "@sub-rosa/sdk";

const DEFAULT_TESTNET_RPC = "https://soroban-testnet.stellar.org";
const DEFAULT_AUTH_ENTRY_LEDGER_TTL = 100;

export type PollarSigningClient = Pick<
  PollarClient,
  "getNetwork" | "getWallet" | "signTx" | "signAuthEntry"
>;

export type PollarAdapterErrorCode =
  | "INVALID_CONFIGURATION"
  | "POLLAR_WALLET_MISSING"
  | "POLLAR_WALLET_NOT_READY"
  | "POLLAR_WALLET_UNSUPPORTED"
  | "POLLAR_NETWORK_MISMATCH"
  | "POLLAR_SIGNING_REJECTED"
  | "POLLAR_COSIGN_PENDING"
  | "MALFORMED_TRANSACTION_XDR"
  | "MALFORMED_AUTH_ENTRY_XDR"
  | "FEE_BUMP_UNSUPPORTED"
  | "SIGNER_MISMATCH"
  | "SIGNED_PAYLOAD_MISMATCH"
  | "LEDGER_LOOKUP_FAILED"
  | "RECEIPT_ONLY_REQUIRED";

export class PollarAdapterError extends Error {
  readonly name = "PollarAdapterError";

  constructor(
    readonly code: PollarAdapterErrorCode,
    message: string,
    options?: { cause?: unknown; pollarCode?: string },
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.pollarCode = options?.pollarCode;
  }

  readonly pollarCode?: string;
}

export interface LatestLedgerReader {
  getLatestLedger(): Promise<{ sequence: number }>;
}

export interface PollarSignerConfig {
  pollar: PollarSigningClient;
  rpcUrl?: string;
  /** Number of ledgers beyond the current testnet ledger. Default: 100. */
  authEntryLedgerTtl?: number;
  /** Test hook or custom RPC transport. */
  ledgerReader?: LatestLedgerReader;
}

export interface PollarSubRosaSigner {
  readonly publicKey: string;
  readonly signTransaction: SignTransaction;
  readonly signAuthEntry: SignAuthEntry;
}

export interface PollarSubRosaClientConfig extends PollarSignerConfig {
  /** Additional safe Sub Rosa client options. Network and signing are fixed by the adapter. */
  subRosa?: Omit<
    SubRosaClientConfig,
    "network" | "rpcUrl" | "networkPassphrase" | "publicKey" | "secretKey" | "signTransaction" | "signAuthEntry"
  >;
}

function receiptOnlyError(): PollarAdapterError {
  return adapterError(
    "RECEIPT_ONLY_REQUIRED",
    "The initial Pollar adapter supports Sub Rosa ReceiptOnly rounds only.",
  );
}

/**
 * Sub Rosa client with the first adapter release's write boundary enforced.
 * Read APIs and the Core v2 ReceiptOnly lifecycle remain unchanged.
 */
export class PollarReceiptOnlyClient extends SubRosaClient {
  async #assertReceiptOnlyRound(roundId: number | bigint): Promise<void> {
    const round = await this.getRoundV2(roundId);
    if (round.mode.tag !== "ReceiptOnly") throw receiptOnlyError();
  }

  override createRound(_params: CreateRoundParams): Promise<bigint> {
    return Promise.reject(receiptOnlyError());
  }

  override createRoundV2(params: CreateRoundV2Params): Promise<bigint> {
    if (params.mode !== "ReceiptOnly") return Promise.reject(receiptOnlyError());
    return super.createRoundV2(params);
  }

  override createPartnerRoundV2(params: CreatePartnerRoundV2Params): Promise<bigint> {
    if (params.mode !== "ReceiptOnly" || params.fixedEscrow !== 0n) {
      return Promise.reject(receiptOnlyError());
    }
    return super.createPartnerRoundV2(params);
  }

  override createRoundV3(params: CreateRoundV3Params): Promise<bigint> {
    if (params.mode !== "ReceiptOnly" || params.fixedEscrow !== 0n) {
      return Promise.reject(receiptOnlyError());
    }
    return super.createRoundV3(params);
  }

  override commitV2(params: CommitV2Params): Promise<void> {
    if (params.escrow !== 0n) return Promise.reject(receiptOnlyError());
    return super.commitV2(params);
  }

  override async openRevealV2(
    roundId: number | bigint,
    drandSignature: Uint8Array,
  ): Promise<void> {
    await this.#assertReceiptOnlyRound(roundId);
    return super.openRevealV2(roundId, drandSignature);
  }

  override async revealV2(params: RevealV2Params): Promise<void> {
    await this.#assertReceiptOnlyRound(params.roundId);
    return super.revealV2(params);
  }

  override async clearV2(roundId: number | bigint): Promise<string | undefined> {
    await this.#assertReceiptOnlyRound(roundId);
    return super.clearV2(roundId);
  }

  override settleV2(_roundId: number | bigint): Promise<void> {
    // ReceiptOnly rounds settle as part of clear_v2 and never call settle_v2.
    return Promise.reject(receiptOnlyError());
  }

  override async voidV2(roundId: number | bigint): Promise<void> {
    await this.#assertReceiptOnlyRound(roundId);
    return super.voidV2(roundId);
  }
}

function adapterError(
  code: PollarAdapterErrorCode,
  message: string,
  cause?: unknown,
): PollarAdapterError {
  return new PollarAdapterError(code, message, { cause });
}

function assertTestnetPassphrase(passphrase: string | undefined): void {
  if (passphrase !== undefined && passphrase !== Networks.TESTNET) {
    throw adapterError(
      "POLLAR_NETWORK_MISMATCH",
      "The Sub Rosa transaction is not configured for Stellar testnet.",
    );
  }
}

function assertWallet(
  pollar: PollarSigningClient,
  expectedAddress?: string,
): string {
  if (pollar.getNetwork() !== "testnet") {
    throw adapterError(
      "POLLAR_NETWORK_MISMATCH",
      `Pollar is connected to ${pollar.getNetwork()}, but this adapter is testnet-only.`,
    );
  }

  const wallet = pollar.getWallet();
  if (!wallet) {
    throw adapterError("POLLAR_WALLET_MISSING", "Pollar has no authenticated Stellar wallet.");
  }
  if (wallet.chain !== undefined && wallet.chain !== "STELLAR") {
    throw adapterError("POLLAR_WALLET_UNSUPPORTED", "The active Pollar wallet is not a Stellar wallet.");
  }
  if (wallet.custody === "smart" || !StrKey.isValidEd25519PublicKey(wallet.address)) {
    throw adapterError(
      "POLLAR_WALLET_UNSUPPORTED",
      "Only classic Stellar G-address Pollar wallets are supported; smart C-address wallets require Pollar's submit flow.",
    );
  }
  if (wallet.provisioning !== undefined && wallet.provisioning !== "READY") {
    throw adapterError(
      "POLLAR_WALLET_NOT_READY",
      `Pollar wallet provisioning is ${wallet.provisioning}; wait for READY before signing.`,
    );
  }
  if (wallet.existsOnStellar === false) {
    throw adapterError(
      "POLLAR_WALLET_NOT_READY",
      "The Pollar wallet does not yet exist on the Stellar ledger.",
    );
  }
  if (expectedAddress !== undefined && wallet.address !== expectedAddress) {
    throw adapterError(
      "SIGNER_MISMATCH",
      "The active Pollar wallet changed after the Sub Rosa client was created.",
    );
  }
  return wallet.address;
}

function parseTransactionXdr(value: string, label: string): Transaction {
  let parsed: Transaction | FeeBumpTransaction;
  try {
    parsed = TransactionBuilder.fromXDR(value, Networks.TESTNET);
  } catch (cause) {
    throw adapterError("MALFORMED_TRANSACTION_XDR", `${label} is not valid Stellar transaction XDR.`, cause);
  }
  if (parsed instanceof FeeBumpTransaction) {
    throw adapterError(
      "FEE_BUMP_UNSUPPORTED",
      `${label} is a fee-bump envelope. The initial adapter requires an unsponsored classic transaction.`,
    );
  }
  return parsed;
}

function verifySignedTransaction(
  unsignedXdr: string,
  signedXdr: string,
  address: string,
): void {
  const unsigned = parseTransactionXdr(unsignedXdr, "unsignedXdr");
  const signed = parseTransactionXdr(signedXdr, "Pollar signedXdr");

  if (unsigned.signatures.length !== 0) {
    throw adapterError(
      "SIGNED_PAYLOAD_MISMATCH",
      "Refusing to sign an envelope that already contains signatures.",
    );
  }
  if (unsigned.source !== address || signed.source !== address) {
    throw adapterError(
      "SIGNER_MISMATCH",
      "The transaction source does not match the active Pollar wallet.",
    );
  }
  if (!unsigned.hash().equals(signed.hash())) {
    throw adapterError(
      "SIGNED_PAYLOAD_MISMATCH",
      "Pollar returned a signature over a different transaction body.",
    );
  }

  const verifier = Keypair.fromPublicKey(address);
  const hash = unsigned.hash();
  const hasExpectedSignature = signed.signatures.some((signature) =>
    verifier.verify(hash, signature.signature()),
  );
  if (!hasExpectedSignature) {
    throw adapterError(
      "SIGNER_MISMATCH",
      "The signed envelope does not contain a valid signature from the active Pollar wallet.",
    );
  }
}

function parseAuthEntryXdr(value: string, label: string): xdr.SorobanAuthorizationEntry {
  try {
    return xdr.SorobanAuthorizationEntry.fromXDR(value, "base64");
  } catch (cause) {
    throw adapterError("MALFORMED_AUTH_ENTRY_XDR", `${label} is not valid Soroban authorization-entry XDR.`, cause);
  }
}

function authEntryAddress(entry: xdr.SorobanAuthorizationEntry): string {
  const credentials = entry.credentials();
  if (credentials.switch().name !== "sorobanCredentialsAddress") {
    throw adapterError(
      "POLLAR_WALLET_UNSUPPORTED",
      "Pollar can only sign address-credential authorization entries for this adapter.",
    );
  }
  return Address.fromScAddress(credentials.address().address()).toString();
}

function verifySignedAuthEntry(
  unsignedXdr: string,
  signedXdr: string,
  address: string,
  currentLedger: number,
): void {
  const unsigned = parseAuthEntryXdr(unsignedXdr, "entryXdr");
  const signed = parseAuthEntryXdr(signedXdr, "Pollar signedAuthEntry");
  if (authEntryAddress(unsigned) !== address || authEntryAddress(signed) !== address) {
    throw adapterError(
      "SIGNER_MISMATCH",
      "The authorization entry address does not match the active Pollar wallet.",
    );
  }
  if (!unsigned.rootInvocation().toXDR().equals(signed.rootInvocation().toXDR())) {
    throw adapterError(
      "SIGNED_PAYLOAD_MISMATCH",
      "Pollar returned a signature for a different Soroban invocation tree.",
    );
  }
  const signedCredentials = signed.credentials().address();
  const signedExpiration = signedCredentials.signatureExpirationLedger();
  if (signedExpiration <= currentLedger || signedExpiration > currentLedger + 1_000) {
    throw adapterError(
      "SIGNED_PAYLOAD_MISMATCH",
      "The signed authorization entry expiration is outside the adapter's safe live-ledger window.",
    );
  }
  if (signedCredentials.signature().switch().name === "scvVoid") {
    throw adapterError(
      "SIGNER_MISMATCH",
      "Pollar returned an authorization entry without a signature.",
    );
  }
}

async function latestLedgerExpiration(
  reader: LatestLedgerReader,
  ttl: number,
): Promise<{ currentLedger: number; validUntilLedger: number }> {
  try {
    const { sequence } = await reader.getLatestLedger();
    const expiration = sequence + ttl;
    if (!Number.isSafeInteger(sequence) || sequence <= 0 || !Number.isSafeInteger(expiration)) {
      throw new Error(`invalid latest ledger sequence ${sequence}`);
    }
    return { currentLedger: sequence, validUntilLedger: expiration };
  } catch (cause) {
    if (cause instanceof PollarAdapterError) throw cause;
    throw adapterError(
      "LEDGER_LOOKUP_FAILED",
      "Could not derive a safe authorization-entry expiration from Stellar testnet RPC.",
      cause,
    );
  }
}

function errorDetails(outcome: { details?: string; message?: string; code?: string }): string {
  return outcome.details ?? outcome.message ?? outcome.code ?? "Pollar rejected signing";
}

export function createPollarSubRosaSigner(config: PollarSignerConfig): PollarSubRosaSigner {
  if (!config?.pollar) {
    throw adapterError("INVALID_CONFIGURATION", "A ready PollarClient is required.");
  }
  const ttl = config.authEntryLedgerTtl ?? DEFAULT_AUTH_ENTRY_LEDGER_TTL;
  if (!Number.isSafeInteger(ttl) || ttl < 1 || ttl > 1_000) {
    throw adapterError(
      "INVALID_CONFIGURATION",
      "authEntryLedgerTtl must be a safe integer between 1 and 1000 ledgers.",
    );
  }

  const publicKey = assertWallet(config.pollar);
  const ledgerReader = config.ledgerReader ?? new rpc.Server(config.rpcUrl ?? DEFAULT_TESTNET_RPC);

  const signTransaction: SignTransaction = async (unsignedXdr, options) => {
    assertTestnetPassphrase(options?.networkPassphrase);
    const address = assertWallet(config.pollar, publicKey);
    if (options?.address !== undefined && options.address !== address) {
      throw adapterError("SIGNER_MISMATCH", "Sub Rosa requested a different transaction signer.");
    }
    const unsigned = parseTransactionXdr(unsignedXdr, "unsignedXdr");
    if (unsigned.source !== address) {
      throw adapterError("SIGNER_MISMATCH", "The transaction source does not match the active Pollar wallet.");
    }

    const outcome = await config.pollar.signTx(unsignedXdr, { skipSponsorship: true });
    if (outcome.status === "cosign_pending") {
      throw adapterError(
        "POLLAR_COSIGN_PENDING",
        "Pollar requires manual co-sign approval before this transaction can be used.",
      );
    }
    if (outcome.status === "error") {
      throw new PollarAdapterError(
        "POLLAR_SIGNING_REJECTED",
        `Pollar rejected transaction signing: ${errorDetails(outcome)}`,
        { pollarCode: outcome.code },
      );
    }
    verifySignedTransaction(unsignedXdr, outcome.signedXdr, address);
    return { signedTxXdr: outcome.signedXdr, signerAddress: address };
  };

  const signAuthEntry: SignAuthEntry = async (entryXdr, options) => {
    assertTestnetPassphrase(options?.networkPassphrase);
    const address = assertWallet(config.pollar, publicKey);
    if (options?.address !== undefined && options.address !== address) {
      throw adapterError("SIGNER_MISMATCH", "Sub Rosa requested a different authorization signer.");
    }
    const entry = parseAuthEntryXdr(entryXdr, "entryXdr");
    if (authEntryAddress(entry) !== address) {
      throw adapterError(
        "SIGNER_MISMATCH",
        "The authorization entry address does not match the active Pollar wallet.",
      );
    }

    const { currentLedger, validUntilLedger } = await latestLedgerExpiration(ledgerReader, ttl);
    const outcome = await config.pollar.signAuthEntry(entryXdr, { validUntilLedger });
    if (outcome.status === "error") {
      throw new PollarAdapterError(
        "POLLAR_SIGNING_REJECTED",
        `Pollar rejected Soroban authorization signing: ${errorDetails(outcome)}`,
        { pollarCode: outcome.code },
      );
    }
    // Pollar's embedded signer uses the requested expiration. External Pollar
    // wallet adapters may choose their own expiration, so validate the signed
    // entry against a bounded live-ledger window instead of assuming equality.
    verifySignedAuthEntry(entryXdr, outcome.signedAuthEntry, address, currentLedger);
    return { signedAuthEntry: outcome.signedAuthEntry, signerAddress: address };
  };

  return { publicKey, signTransaction, signAuthEntry };
}

export function createPollarSubRosaClient(
  config: PollarSubRosaClientConfig,
): { client: PollarReceiptOnlyClient; signer: PollarSubRosaSigner } {
  const signer = createPollarSubRosaSigner(config);
  const client = new PollarReceiptOnlyClient({
    ...config.subRosa,
    network: "testnet",
    rpcUrl: config.rpcUrl,
    publicKey: signer.publicKey,
    signTransaction: signer.signTransaction,
    signAuthEntry: signer.signAuthEntry,
  });
  return { client, signer };
}
