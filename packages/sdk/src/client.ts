// SubRosaClient — a thin, ergonomic, spec-accurate wrapper over the generated
// Round contract bindings. Direct Soroban RPC is the default submission path;
// callers can optionally inject a submitter (for example OZ Relayer Channels)
// without changing contract call encoding. Argument encoding is delegated to the
// contract Spec embedded in the generated bindings, so the bytes on the wire are
// exactly what the contract expects.

import { Keypair, rpc } from "@stellar/stellar-sdk";
import type {
  AssembledTransaction,
  Result,
  SignAuthEntry,
  SignTransaction,
} from "@stellar/stellar-sdk/contract";
import { basicNodeSigner } from "@stellar/stellar-sdk/contract";
import {
  Client as RoundContract,
  type BidState,
  type BiddersPage,
  type ClearingRule,
  type GlobalConfig,
  type Round,
  type RoundMode,
  type RoundPolicyV2,
  type RevealPolicy,
  type RevealStateV3,
  type RoundV2,
  type Seal,
  type SettlementConfig,
  type SubmissionStateV2,
} from "@sub-rosa/round-bindings";
import { encodePayloadEnvelope, toHex } from "@sub-rosa/tlock";
import type {
  PayloadEnvelope,
  SealedBid,
  SealedPayload,
} from "@sub-rosa/tlock";
import type { RoundReceipt } from "./receipt.js";
import type { CoreV2Receipt } from "./receipt-v2.js";
import { validateEncryptedBlob } from "./encrypted-blob.js";
import { networkFingerprint } from "./receipt.js";
import type { TransactionSubmitter } from "./submitter.js";
import {
  evaluatePreflight,
  classifyPreflightBuildError,
  type PreflightOperation,
  type PreflightResult,
} from "./preflight.js";
import {
  SubRosaClientConfigError,
  SubRosaMissingReturnValueError,
  SubRosaNetworkMismatchError,
  SubRosaSubmitError,
  SubRosaTimeoutError,
  SubRosaTransactionError,
} from "./errors.js";
import { normalizeRoundId, normalizeSorobanContractId } from "./ids.js";
import { validateContractNetwork } from "./network.js";
import {
  resolveSubRosaDeployment,
  type SubRosaNetwork,
} from "./deployments.js";

export interface SubRosaClientConfig {
  /** Named Stellar network. Supplies the canonical RPC, passphrase, and deployment. */
  network?: SubRosaNetwork;
  /** Soroban RPC endpoint, e.g. https://soroban-testnet.stellar.org */
  rpcUrl?: string;
  /** Network passphrase the contract is deployed on. */
  networkPassphrase?: string;
  /** Deployed Round contract id (C…). */
  contractId?: string;
  /**
   * Secret key (S…) of the account that signs and pays for state-changing
   * calls. Required for create_round/commit/open_reveal/reveal/clear/settle/void.
   * Read-only calls (get_*) work without it.
   */
  secretKey?: string;
  /**
   * Public key (G…) used as the source for read-only simulation when no
   * `secretKey` is given. Ignored when `secretKey` is provided.
   */
  publicKey?: string;
  /** Wallet adapter compatible with Freighter's signTransaction API. */
  signTransaction?: SignTransaction;
  /** Wallet adapter for Soroban authorization entries when required. */
  signAuthEntry?: SignAuthEntry;
  /** Allow http RPC URLs (e.g. a local quickstart node). Default: false. */
  allowHttp?: boolean;
  /** Optional external submitter. Direct Soroban RPC remains the default. */
  submitter?: TransactionSubmitter;
  /**
   * How long (ms) to poll RPC for transaction finality when using an external
   * submitter. Must be at least 1_000. Default: 60_000.
   */
  confirmTimeout?: number;
  /**
   * How long (ms) to wait between polling RPC for transaction status when
   * using an external submitter. Must be at least 100. Default: 1_500.
   */
  pollInterval?: number;
  /**
   * @internal Testing hook: override the poll-loop sleep function.
   */
  _sleep?: (ms: number) => Promise<void>;
  /**
   * @internal Testing hook: inject a mock Soroban RPC server for simulation.
   */
  _server?: rpc.Server;
}

export type ClearingRuleTag = ClearingRule["tag"];
export type RoundModeTag = RoundMode["tag"];

export const MAX_V2_PARTICIPANTS = 25;

export interface CreateRoundParams {
  /** sha256 (or any opaque 32-byte ref) of the off-chain item description. */
  itemRef: Uint8Array;
  /** Drand round R whose signature unseals the bids. */
  revealRound: number | bigint;
  /** Unix seconds; strictly before time(R). */
  commitDeadline: number | bigint;
  /** Unix seconds; after time(R). */
  revealDeadline: number | bigint;
  /** Auditor public key (selective disclosure) bidder identities seal to. */
  auditorPubkey: Uint8Array;
  /** Clearing rule. Default: HighestBid (first-price sealed-bid auction). */
  clearingRule?: ClearingRuleTag;
  /** Operator address. Default: the configured signer's public key. */
  operator?: string;
}

export interface CommitParams {
  roundId: number | bigint;
  /** The off-chain seal produced by @sub-rosa/tlock `sealBid`. */
  sealed: SealedBid;
  /** Public USDC budget locked now; upper bound on the sealed bid. */
  escrow: bigint;
  /** Bidder address. Default: the configured signer's public key. */
  bidder?: string;
}

export interface RevealParams {
  roundId: number | bigint;
  /** The address the bid was committed under. */
  bidder: string;
  /** The plaintext value revealed from the seal. */
  value: bigint;
  /** The 32-byte nonce revealed from the seal. */
  nonce: Uint8Array;
}

export interface CreateRoundV2Params {
  /** Opaque 32-byte reference to the auction lot or proposal request. */
  itemRef: Uint8Array;
  /** Opaque 32-byte reference to the application payload schema. */
  schemaRef: Uint8Array;
  /** Auction locks escrow; ReceiptOnly proves simultaneous reveal without funds. */
  mode: RoundModeTag;
  /** SAC used for escrow and seller payment in Auction mode. */
  paymentAsset?: string;
  /** SAC lot held in custody and transferred to the winner in Auction mode. */
  lotAsset?: string;
  /** Lot units held in custody. Required and positive in Auction mode. */
  lotAmount?: bigint;
  revealRound: number | bigint;
  commitDeadline: number | bigint;
  revealDeadline: number | bigint;
  auditorPubkey: Uint8Array;
  /** Protocol-enforced participant cap. Default and maximum: 25. */
  maxParticipants?: number;
  clearingRule?: ClearingRuleTag;
  operator?: string;
}

export interface CreatePartnerRoundV2Params extends CreateRoundV2Params {
  /** Identical public escrow required from every Auction participant. Must be zero for ReceiptOnly. */
  fixedEscrow: bigint;
  /** Empty or omitted means open participation; otherwise only these addresses may commit. */
  eligibleParticipants?: string[];
}

export interface CreateRoundV3Params extends CreatePartnerRoundV2Params {
  /** Controls on-chain opening only. Controller is the immutable round operator. */
  revealPolicy: { type: "timed" } | { type: "owner-triggered"; fallbackAt: number | bigint };
}

export interface CommitV2Params {
  roundId: number | bigint;
  /** Structured seal produced by @sub-rosa/tlock `sealPayload`. */
  sealed: SealedPayload;
  /** Must be positive for Auction and zero for ReceiptOnly rounds. */
  escrow: bigint;
  bidder?: string;
}

export interface RevealV2Params {
  roundId: number | bigint;
  bidder: string;
  /** The structured plaintext returned by @sub-rosa/tlock `openPayload`. */
  envelope: PayloadEnvelope;
}

const toBigInt = (v: number | bigint): bigint =>
  typeof v === "bigint" ? v : BigInt(v);

const toBuffer = (b: Uint8Array): Buffer => Buffer.from(b);

function isMissingContractFunction(error: unknown, functionName: string): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes(functionName) &&
    message.includes("trying to invoke non-existent contract function")
  );
}

function v2RoundArgs(
  params: CreateRoundV2Params,
  operator: string,
) {
  const max_participants = params.maxParticipants ?? MAX_V2_PARTICIPANTS;
  if (!Number.isInteger(max_participants) || max_participants < 1 || max_participants > MAX_V2_PARTICIPANTS) {
    throw new SubRosaClientConfigError(
      `maxParticipants must be an integer between 1 and ${MAX_V2_PARTICIPANTS}`,
    );
  }
  const lotAmount = params.lotAmount ?? 0n;
  if (
    params.mode === "Auction" &&
    (!params.paymentAsset || !params.lotAsset || lotAmount <= 0n)
  ) {
    throw new SubRosaClientConfigError(
      "Auction rounds require paymentAsset, lotAsset, and a positive lotAmount",
    );
  }
  if (
    params.mode === "ReceiptOnly" &&
    (params.paymentAsset !== undefined ||
      params.lotAsset !== undefined ||
      lotAmount !== 0n)
  ) {
    throw new SubRosaClientConfigError(
      "ReceiptOnly rounds cannot configure payment or lot settlement",
    );
  }
  const settlement: SettlementConfig = {
    mode: { tag: params.mode, values: undefined } as RoundMode,
    payment_asset: params.paymentAsset,
    lot_asset: params.lotAsset,
    lot_amount: lotAmount,
  };
  return {
    operator,
    item_ref: toBuffer(params.itemRef),
    schema_ref: toBuffer(params.schemaRef),
    settlement,
    reveal_round: toBigInt(params.revealRound),
    clearing_rule: {
      tag: params.clearingRule ?? "HighestBid",
      values: undefined,
    } as ClearingRule,
    commit_deadline: toBigInt(params.commitDeadline),
    reveal_deadline: toBigInt(params.revealDeadline),
    auditor_pubkey: toBuffer(params.auditorPubkey),
    max_participants,
  };
}

function partnerV2RoundArgs(
  params: CreatePartnerRoundV2Params,
  operator: string,
) {
  const { settlement, ...round } = v2RoundArgs(params, operator);
  const eligibleParticipants = params.eligibleParticipants ?? [];
  if (params.mode === "Auction" && params.fixedEscrow <= 0n) {
    throw new SubRosaClientConfigError(
      "Auction partner rounds require a positive fixedEscrow",
    );
  }
  if (params.mode === "ReceiptOnly" && params.fixedEscrow !== 0n) {
    throw new SubRosaClientConfigError(
      "ReceiptOnly partner rounds require fixedEscrow to be zero",
    );
  }
  if (eligibleParticipants.length > round.max_participants) {
    throw new SubRosaClientConfigError(
      "eligibleParticipants cannot exceed maxParticipants",
    );
  }
  if (new Set(eligibleParticipants).size !== eligibleParticipants.length) {
    throw new SubRosaClientConfigError(
      "eligibleParticipants cannot contain duplicates",
    );
  }
  const policy: RoundPolicyV2 = {
    settlement,
    fixed_escrow: params.fixedEscrow,
    eligible_participants: eligibleParticipants,
  };
  return { ...round, policy };
}

function v3RoundArgs(params: CreateRoundV3Params, operator: string) {
  const { policy: partner, ...round } = partnerV2RoundArgs(params, operator);
  let reveal: RevealPolicy;
  if (params.revealPolicy.type === "timed") {
    reveal = { tag: "Timed", values: undefined };
  } else if (params.revealPolicy.type === "owner-triggered") {
    const value = params.revealPolicy.fallbackAt;
    if (typeof value === "number" && !Number.isSafeInteger(value)) {
      throw new SubRosaClientConfigError("fallbackAt must be a safe integer Unix timestamp");
    }
    const fallback = toBigInt(value);
    if (fallback <= 0n || fallback > (1n << 64n) - 1n || round.reveal_deadline - fallback < 300n) {
      throw new SubRosaClientConfigError("fallbackAt must leave at least 300 seconds before revealDeadline");
    }
    reveal = { tag: "OwnerTriggered", values: [fallback] };
  } else {
    throw new SubRosaClientConfigError("unsupported reveal policy");
  }
  return { ...round, policy: { partner, reveal } };
}

export class SubRosaClient {
  readonly contract: RoundContract;
  readonly contractId: string;
  readonly networkPassphrase: string;
  readonly #source?: string;
  readonly #rpcUrl: string;
  readonly #allowHttp: boolean;
  readonly #submitter?: TransactionSubmitter;
  readonly #confirmTimeout: number;
  readonly #pollInterval: number;
  readonly #server: rpc.Server;
  readonly #submittedTransactionHashes: string[] = [];
  #networkValidation?: Promise<void>;

  constructor(config: SubRosaClientConfig) {
    const resolved = config.network
      ? resolveSubRosaDeployment(config.network, {
          contractId: config.contractId,
          rpcUrl: config.rpcUrl,
          networkPassphrase: config.networkPassphrase,
        })
      : {
          rpcUrl: config.rpcUrl?.trim(),
          networkPassphrase: config.networkPassphrase?.trim(),
          contractId: config.contractId?.trim(),
        };
    if (!resolved.rpcUrl || !resolved.networkPassphrase || !resolved.contractId) {
      throw new SubRosaClientConfigError(
        "provide network=\"testnet\"|\"mainnet\", or provide rpcUrl, networkPassphrase, and contractId together",
      );
    }

    const allowHttp = config.allowHttp ?? false;
    if (/^http:\/\//i.test(resolved.rpcUrl) && !allowHttp) {
      throw new SubRosaClientConfigError(
        "rpcUrl must use https unless allowHttp is explicitly enabled",
      );
    }

    const confirmTimeout = config.confirmTimeout ?? 60_000;
    if (!Number.isFinite(confirmTimeout) || confirmTimeout < 1_000) {
      throw new SubRosaClientConfigError(
        `confirmTimeout must be a finite number at least 1000ms, got ${confirmTimeout}`,
      );
    }

    const pollInterval = config.pollInterval ?? 1_500;
    if (!Number.isFinite(pollInterval) || pollInterval < 100) {
      throw new SubRosaClientConfigError(
        `pollInterval must be a finite number at least 100ms, got ${pollInterval}`,
      );
    }

    if (config.secretKey && (config.signTransaction || config.signAuthEntry)) {
      throw new SubRosaClientConfigError(
        "provide either secretKey or wallet signing callbacks, not both",
      );
    }
    if ((config.signTransaction || config.signAuthEntry) && !config.publicKey) {
      throw new SubRosaClientConfigError(
        "publicKey is required when wallet signing callbacks are provided",
      );
    }

    const keypair = config.secretKey
      ? Keypair.fromSecret(config.secretKey)
      : undefined;
    const source = keypair?.publicKey() ?? config.publicKey;
    const nodeSigner = keypair
      ? basicNodeSigner(keypair, resolved.networkPassphrase)
      : undefined;
    const signTransaction = nodeSigner?.signTransaction ?? config.signTransaction;
    const signAuthEntry = nodeSigner?.signAuthEntry ?? config.signAuthEntry;

    this.contractId = normalizeSorobanContractId(resolved.contractId);
    this.networkPassphrase = resolved.networkPassphrase;
    this.#source = source;
    this.#rpcUrl = resolved.rpcUrl;
    this.#allowHttp = allowHttp;
    this.#submitter = config.submitter;
    this.#confirmTimeout = confirmTimeout;
    this.#pollInterval = pollInterval;
    this.#server = config._server ?? new rpc.Server(resolved.rpcUrl, { allowHttp });
    if (config._sleep) this.#sleep = config._sleep;
    this.contract = new RoundContract({
      contractId: this.contractId,
      networkPassphrase: resolved.networkPassphrase,
      rpcUrl: resolved.rpcUrl,
      allowHttp,
      ...(source ? { publicKey: source } : {}),
      ...(signTransaction ? { signTransaction } : {}),
      ...(signAuthEntry ? { signAuthEntry } : {}),
      server: this.#server,
    });
  }

  /** The contract Spec embedded in the bindings — the single source of truth
   *  for argument/return encoding. Exposed for offline encoding checks. */
  get spec() {
    return this.contract.spec;
  }

  /** Successful state-changing transactions submitted by this client instance. */
  get submittedTransactionHashes(): readonly string[] {
    return [...this.#submittedTransactionHashes];
  }

  #requireSource(role: string): string {
    if (!this.#source) {
      throw new SubRosaClientConfigError(
        `a secretKey (or publicKey) is required to use it as the ${role}`,
      );
    }
    return this.#source;
  }

  async #validatedContractCall<T>(build: () => Promise<T>): Promise<T> {
    if (!this.#networkValidation) {
      this.#networkValidation = validateContractNetwork(this.#server, {
        networkPassphrase: this.networkPassphrase,
        contractId: this.contractId,
        rpcUrl: this.#rpcUrl,
      }).catch((error: unknown) => {
        this.#networkValidation = undefined;
        throw error;
      });
    }
    await this.#networkValidation;
    return build();
  }

  async #sendUnwrap<T>(tx: AssembledTransaction<Result<T>>): Promise<T> {
    if (!this.#submitter) {
      try {
        const sent = await tx.signAndSend();
        const result = sent.result.unwrap();
        const hash = sent.sendTransactionResponse?.hash;
        if (hash) this.#submittedTransactionHashes.push(hash);
        return result;
      } catch (e) {
        throw new SubRosaSubmitError("direct RPC submission failed", { cause: e });
      }
    }

    await tx.sign();
    if (!tx.signed) throw new SubRosaSubmitError("transaction was not signed");
    let submitted;
    try {
      submitted = await this.#submitter.submitSignedTransaction({
        signedTransactionXdr: tx.signed.toXDR(),
        contractId: this.contractId,
        networkPassphrase: this.networkPassphrase,
        rpcUrl: this.#rpcUrl,
      });
    } catch (e) {
      throw new SubRosaSubmitError(
        `${this.#submitter.name} failed to submit transaction`,
        { cause: e },
      );
    }
    const server = new rpc.Server(this.#rpcUrl, { allowHttp: this.#allowHttp });
    const deadline = Date.now() + this.#confirmTimeout;
    let lastStatus = "NOT_FOUND";
    while (Date.now() < deadline) {
      let res;
      try {
        res = await server.getTransaction(submitted.hash);
      } catch (e) {
        throw new SubRosaSubmitError(
          `RPC getTransaction failed for ${submitted.hash}`,
          { cause: e },
        );
      }
      lastStatus = res.status;
      if (res.status === rpc.Api.GetTransactionStatus.SUCCESS) {
        if (!("returnValue" in res) || !res.returnValue) {
          throw new SubRosaMissingReturnValueError(submitted.hash);
        }
        const result = tx.options.parseResultXdr(res.returnValue).unwrap();
        this.#submittedTransactionHashes.push(submitted.hash);
        return result;
      }
      if (res.status !== rpc.Api.GetTransactionStatus.NOT_FOUND) {
        throw new SubRosaTransactionError(submitted.hash, res.status);
      }
      await this.#sleep(this.#pollInterval);
    }
    throw new SubRosaTimeoutError({
      hash: submitted.hash,
      submitter: this.#submitter.name,
      lastStatus,
      timeoutMs: this.#confirmTimeout,
      pollIntervalMs: this.#pollInterval,
    });
  }

  #sleep: (ms: number) => Promise<void> = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms));

  // ── State-changing calls (sign + submit over RPC) ──────────────────────

  async createRound(params: CreateRoundParams): Promise<bigint> {
    const operator = params.operator ?? this.#requireSource("operator");
    const clearing_rule = {
      tag: params.clearingRule ?? "HighestBid",
      values: undefined,
    } as ClearingRule;
    const tx = await this.#validatedContractCall(() =>
      this.contract.create_round({
        operator,
        item_ref: toBuffer(params.itemRef),
        reveal_round: toBigInt(params.revealRound),
        clearing_rule,
        commit_deadline: toBigInt(params.commitDeadline),
        reveal_deadline: toBigInt(params.revealDeadline),
        auditor_pubkey: toBuffer(params.auditorPubkey),
      }),
    );
    return this.#sendUnwrap(tx);
  }

  async createRoundV2(params: CreateRoundV2Params): Promise<bigint> {
    const operator = params.operator ?? this.#requireSource("operator");
    const tx = await this.#validatedContractCall(() =>
      this.contract.create_round_v2(v2RoundArgs(params, operator)),
    );
    return this.#sendUnwrap(tx);
  }

  async createPartnerRoundV2(
    params: CreatePartnerRoundV2Params,
  ): Promise<bigint> {
    const operator = params.operator ?? this.#requireSource("operator");
    const tx = await this.#validatedContractCall(() =>
      this.contract.create_partner_round_v2(
        partnerV2RoundArgs(params, operator),
      ),
    );
    return this.#sendUnwrap(tx);
  }

  async createRoundV3(params: CreateRoundV3Params): Promise<bigint> {
    const operator = params.operator ?? this.#requireSource("operator");
    const tx = await this.#validatedContractCall(() =>
      this.contract.create_round_v3(v3RoundArgs(params, operator)),
    );
    return this.#sendUnwrap(tx);
  }

  preflightCreateRoundV3(params: CreateRoundV3Params): Promise<PreflightResult<bigint>> {
    return this.#preflight("create_round_v3", () => {
      const operator = params.operator ?? this.#requireSource("operator");
      return this.#validatedContractCall(() => this.contract.create_round_v3(v3RoundArgs(params, operator)));
    });
  }

  async commit(params: CommitParams): Promise<void> {
    // Validate encrypted blobs before submitting — catches size/encoding
    // issues early, before paying gas for an on-chain revert (PayloadTooLarge).
    const ciphertextResult = validateEncryptedBlob(
      params.sealed.ciphertext,
      "ciphertext",
    );
    if (!ciphertextResult.valid) {
      throw new SubRosaClientConfigError(
        ciphertextResult.issues.map((i) => i.message).join("; "),
      );
    }
    const auditorBlobResult = validateEncryptedBlob(
      params.sealed.auditorBlob,
      "auditor_blob",
    );
    if (!auditorBlobResult.valid) {
      throw new SubRosaClientConfigError(
        auditorBlobResult.issues.map((i) => i.message).join("; "),
      );
    }

    const bidder = params.bidder ?? this.#requireSource("bidder");
    const tx = await this.#validatedContractCall(() =>
      this.contract.commit({
        round_id: normalizeRoundId(params.roundId),
        bidder,
        commitment: toBuffer(params.sealed.commitment),
        ciphertext: toBuffer(params.sealed.ciphertext),
        escrow: params.escrow,
        auditor_blob: toBuffer(params.sealed.auditorBlob),
      }),
    );
    await this.#sendUnwrap(tx);
  }

  async commitV2(params: CommitV2Params): Promise<void> {
    if (params.sealed.version !== 1) {
      throw new SubRosaClientConfigError(
        `unsupported sealed payload version ${params.sealed.version}`,
      );
    }
    const ciphertextResult = validateEncryptedBlob(
      params.sealed.ciphertext,
      "ciphertext",
    );
    if (!ciphertextResult.valid) {
      throw new SubRosaClientConfigError(
        ciphertextResult.issues.map((issue) => issue.message).join("; "),
      );
    }
    const auditorBlobResult = validateEncryptedBlob(
      params.sealed.auditorBlob,
      "auditor_blob",
    );
    if (!auditorBlobResult.valid) {
      throw new SubRosaClientConfigError(
        auditorBlobResult.issues.map((issue) => issue.message).join("; "),
      );
    }

    const bidder = params.bidder ?? this.#requireSource("bidder");
    const tx = await this.#validatedContractCall(() =>
      this.contract.commit_v2({
        round_id: normalizeRoundId(params.roundId),
        bidder,
        commitment: toBuffer(params.sealed.commitment),
        ciphertext: toBuffer(params.sealed.ciphertext),
        escrow: params.escrow,
        auditor_blob: toBuffer(params.sealed.auditorBlob),
      }),
    );
    await this.#sendUnwrap(tx);
  }

  /** Partner-facing alias: submit a structured sealed payload to Core v2. */
  submitV2(params: CommitV2Params): Promise<void> {
    return this.commitV2(params);
  }

  async openReveal(
    roundId: number | bigint,
    drandSignature: Uint8Array,
  ): Promise<void> {
    const tx = await this.#validatedContractCall(() =>
      this.contract.open_reveal({
        round_id: normalizeRoundId(roundId),
        drand_signature: toBuffer(drandSignature),
      }),
    );
    await this.#sendUnwrap(tx);
  }

  async openRevealV2(
    roundId: number | bigint,
    drandSignature: Uint8Array,
  ): Promise<void> {
    const tx = await this.#validatedContractCall(() =>
      this.contract.open_reveal_v2({
        round_id: normalizeRoundId(roundId),
        drand_signature: toBuffer(drandSignature),
      }),
    );
    await this.#sendUnwrap(tx);
  }

  async reveal(params: RevealParams): Promise<void> {
    const tx = await this.#validatedContractCall(() =>
      this.contract.reveal({
        round_id: normalizeRoundId(params.roundId),
        bidder: params.bidder,
        value: params.value,
        nonce: toBuffer(params.nonce),
      }),
    );
    await this.#sendUnwrap(tx);
  }

  async revealV2(params: RevealV2Params): Promise<void> {
    const tx = await this.#validatedContractCall(() =>
      this.contract.reveal_v2({
        round_id: normalizeRoundId(params.roundId),
        bidder: params.bidder,
        envelope: toBuffer(encodePayloadEnvelope(params.envelope)),
      }),
    );
    await this.#sendUnwrap(tx);
  }

  /** Clear a round. Returns the winning address, or undefined if the round was
   *  voided for having no valid bids. */
  async clear(roundId: number | bigint): Promise<string | undefined> {
    const tx = await this.#validatedContractCall(() =>
      this.contract.clear({ round_id: normalizeRoundId(roundId) }),
    );
    const winner = await this.#sendUnwrap(tx);
    return winner ?? undefined;
  }

  async clearV2(roundId: number | bigint): Promise<string | undefined> {
    const tx = await this.#validatedContractCall(() =>
      this.contract.clear_v2({ round_id: normalizeRoundId(roundId) }),
    );
    const winner = await this.#sendUnwrap(tx);
    return winner ?? undefined;
  }

  async settle(roundId: number | bigint): Promise<void> {
    const tx = await this.#validatedContractCall(() =>
      this.contract.settle({ round_id: normalizeRoundId(roundId) }),
    );
    await this.#sendUnwrap(tx);
  }

  async settleV2(roundId: number | bigint): Promise<void> {
    const tx = await this.#validatedContractCall(() =>
      this.contract.settle_v2({ round_id: normalizeRoundId(roundId) }),
    );
    await this.#sendUnwrap(tx);
  }

  async void(roundId: number | bigint): Promise<void> {
    const tx = await this.#validatedContractCall(() =>
      this.contract.void({ round_id: normalizeRoundId(roundId) }),
    );
    await this.#sendUnwrap(tx);
  }

  async voidV2(roundId: number | bigint): Promise<void> {
    const tx = await this.#validatedContractCall(() =>
      this.contract.void_v2({ round_id: normalizeRoundId(roundId) }),
    );
    await this.#sendUnwrap(tx);
  }

  // ── Preflight simulation (no signing/submission) ─────────────────────

  async #preflight<T>(
    operation: PreflightOperation,
    buildTx: () => Promise<AssembledTransaction<Result<T>>>,
  ): Promise<PreflightResult<T>> {
    try {
      const tx = await buildTx();
      return evaluatePreflight(operation, tx);
    } catch (error) {
      if (
        error instanceof SubRosaClientConfigError ||
        error instanceof SubRosaNetworkMismatchError
      ) {
        throw error;
      }
      return {
        ok: false,
        operation,
        error: classifyPreflightBuildError(operation, error),
      };
    }
  }

  /** Simulate `createRound` without signing or submitting. */
  preflightCreateRound(params: CreateRoundParams): Promise<PreflightResult<bigint>> {
    return this.#preflight("create_round", () => {
      const operator = params.operator ?? this.#requireSource("operator");
      const clearing_rule = {
        tag: params.clearingRule ?? "HighestBid",
        values: undefined,
      } as ClearingRule;
      return this.#validatedContractCall(() =>
        this.contract.create_round({
          operator,
          item_ref: toBuffer(params.itemRef),
          reveal_round: toBigInt(params.revealRound),
          clearing_rule,
          commit_deadline: toBigInt(params.commitDeadline),
          reveal_deadline: toBigInt(params.revealDeadline),
          auditor_pubkey: toBuffer(params.auditorPubkey),
        }),
      );
    });
  }

  /** Simulate `commit` without signing or submitting. */
  preflightCommit(params: CommitParams): Promise<PreflightResult<void>> {
    return this.#preflight("commit", () => {
      const bidder = params.bidder ?? this.#requireSource("bidder");
      return this.#validatedContractCall(() =>
        this.contract.commit({
          round_id: toBigInt(params.roundId),
          bidder,
          commitment: toBuffer(params.sealed.commitment),
          ciphertext: toBuffer(params.sealed.ciphertext),
          escrow: params.escrow,
          auditor_blob: toBuffer(params.sealed.auditorBlob),
        }),
      );
    });
  }

  /** Simulate `openReveal` without signing or submitting. */
  preflightOpenReveal(
    roundId: number | bigint,
    drandSignature: Uint8Array,
  ): Promise<PreflightResult<void>> {
    return this.#preflight("open_reveal", () =>
      this.#validatedContractCall(() =>
        this.contract.open_reveal({
          round_id: toBigInt(roundId),
          drand_signature: toBuffer(drandSignature),
        }),
      ),
    );
  }

  /** Simulate `reveal` without signing or submitting. */
  preflightReveal(params: RevealParams): Promise<PreflightResult<void>> {
    return this.#preflight("reveal", () =>
      this.#validatedContractCall(() =>
        this.contract.reveal({
          round_id: toBigInt(params.roundId),
          bidder: params.bidder,
          value: params.value,
          nonce: toBuffer(params.nonce),
        }),
      ),
    );
  }

  /** Simulate `clear` without signing or submitting. */
  async preflightClear(
    roundId: number | bigint,
  ): Promise<PreflightResult<string | undefined>> {
    const result = await this.#preflight<string | null | undefined>("clear", () =>
      this.#validatedContractCall(() =>
        this.contract.clear({ round_id: toBigInt(roundId) }),
      ),
    );
    if (!result.ok) {
      return result;
    }
    return {
      ...result,
      result: result.result ?? undefined,
    };
  }

  /** Simulate `settle` without signing or submitting. */
  preflightSettle(roundId: number | bigint): Promise<PreflightResult<void>> {
    return this.#preflight("settle", () =>
      this.#validatedContractCall(() =>
        this.contract.settle({ round_id: toBigInt(roundId) }),
      ),
    );
  }

  /** Simulate `void` without signing or submitting. */
  preflightVoid(roundId: number | bigint): Promise<PreflightResult<void>> {
    return this.#preflight("void", () =>
      this.#validatedContractCall(() =>
        this.contract.void({ round_id: toBigInt(roundId) }),
      ),
    );
  }

  /** Simulate `createRoundV2` without signing or submitting. */
  preflightCreateRoundV2(
    params: CreateRoundV2Params,
  ): Promise<PreflightResult<bigint>> {
    return this.#preflight("create_round_v2", () => {
      const operator = params.operator ?? this.#requireSource("operator");
      return this.#validatedContractCall(() =>
        this.contract.create_round_v2(v2RoundArgs(params, operator)),
      );
    });
  }

  /** Simulate `createPartnerRoundV2` without signing or submitting. */
  preflightCreatePartnerRoundV2(
    params: CreatePartnerRoundV2Params,
  ): Promise<PreflightResult<bigint>> {
    return this.#preflight("create_partner_round_v2", () => {
      const operator = params.operator ?? this.#requireSource("operator");
      return this.#validatedContractCall(() =>
        this.contract.create_partner_round_v2(
          partnerV2RoundArgs(params, operator),
        ),
      );
    });
  }

  /** Simulate `commitV2` without signing or submitting. */
  preflightCommitV2(params: CommitV2Params): Promise<PreflightResult<void>> {
    return this.#preflight("commit_v2", () => {
      if (params.sealed.version !== 1) {
        throw new SubRosaClientConfigError(
          `unsupported sealed payload version ${params.sealed.version}`,
        );
      }
      const bidder = params.bidder ?? this.#requireSource("bidder");
      return this.#validatedContractCall(() =>
        this.contract.commit_v2({
          round_id: normalizeRoundId(params.roundId),
          bidder,
          commitment: toBuffer(params.sealed.commitment),
          ciphertext: toBuffer(params.sealed.ciphertext),
          escrow: params.escrow,
          auditor_blob: toBuffer(params.sealed.auditorBlob),
        }),
      );
    });
  }

  preflightOpenRevealV2(
    roundId: number | bigint,
    drandSignature: Uint8Array,
  ): Promise<PreflightResult<void>> {
    return this.#preflight("open_reveal_v2", () =>
      this.#validatedContractCall(() =>
        this.contract.open_reveal_v2({
          round_id: normalizeRoundId(roundId),
          drand_signature: toBuffer(drandSignature),
        }),
      ),
    );
  }

  preflightRevealV2(params: RevealV2Params): Promise<PreflightResult<void>> {
    return this.#preflight("reveal_v2", () =>
      this.#validatedContractCall(() =>
        this.contract.reveal_v2({
          round_id: normalizeRoundId(params.roundId),
          bidder: params.bidder,
          envelope: toBuffer(encodePayloadEnvelope(params.envelope)),
        }),
      ),
    );
  }

  async preflightClearV2(
    roundId: number | bigint,
  ): Promise<PreflightResult<string | undefined>> {
    const result = await this.#preflight<string | null | undefined>(
      "clear_v2",
      () =>
        this.#validatedContractCall(() =>
          this.contract.clear_v2({ round_id: normalizeRoundId(roundId) }),
        ),
    );
    if (!result.ok) return result;
    return { ...result, result: result.result ?? undefined };
  }

  preflightSettleV2(
    roundId: number | bigint,
  ): Promise<PreflightResult<void>> {
    return this.#preflight("settle_v2", () =>
      this.#validatedContractCall(() =>
        this.contract.settle_v2({ round_id: normalizeRoundId(roundId) }),
      ),
    );
  }

  preflightVoidV2(roundId: number | bigint): Promise<PreflightResult<void>> {
    return this.#preflight("void_v2", () =>
      this.#validatedContractCall(() =>
        this.contract.void_v2({ round_id: normalizeRoundId(roundId) }),
      ),
    );
  }

  // ── Read-only views (simulation only; no signing/submission) ───────────

  async getRound(roundId: number | bigint): Promise<Round> {
    const tx = await this.#validatedContractCall(() =>
      this.contract.get_round({ round_id: normalizeRoundId(roundId) }),
    );
    return tx.result.unwrap();
  }

  async getRoundV2(roundId: number | bigint): Promise<RoundV2> {
    const tx = await this.#validatedContractCall(() =>
      this.contract.get_round_v2({ round_id: normalizeRoundId(roundId) }),
    );
    return tx.result.unwrap();
  }

  /** Only an explicitly missing capability function denotes a legacy deployment. */
  async supportsRevealPolicy(): Promise<boolean> {
    try {
      const tx = await this.#validatedContractCall(() => this.contract.protocol_version());
      return tx.result === 3;
    } catch (error) {
      if (isMissingContractFunction(error, "protocol_version")) return false;
      throw error;
    }
  }

  async getRevealStateV3(roundId: number | bigint): Promise<RevealStateV3> {
    const tx = await this.#validatedContractCall(() =>
      this.contract.get_reveal_state_v3({ round_id: normalizeRoundId(roundId) }),
    );
    return tx.result.unwrap();
  }

  async getRoundPolicyV2(
    roundId: number | bigint,
  ): Promise<RoundPolicyV2 | undefined> {
    try {
      const tx = await this.#validatedContractCall(() =>
        this.contract.get_round_policy_v2({
          round_id: normalizeRoundId(roundId),
        }),
      );
      return tx.result ?? undefined;
    } catch (error) {
      if (isMissingContractFunction(error, "get_round_policy_v2")) {
        return undefined;
      }
      throw error;
    }
  }

  async getBidState(
    roundId: number | bigint,
    bidder: string,
  ): Promise<BidState> {
    const tx = await this.#validatedContractCall(() =>
      this.contract.get_bid_state({
        round_id: normalizeRoundId(roundId),
        bidder,
      }),
    );
    return tx.result.unwrap();
  }

  async getSubmissionV2(
    roundId: number | bigint,
    bidder: string,
  ): Promise<SubmissionStateV2> {
    const tx = await this.#validatedContractCall(() =>
      this.contract.get_submission_v2({
        round_id: normalizeRoundId(roundId),
        bidder,
      }),
    );
    return tx.result.unwrap();
  }

  /** The deterministic, ordered bidder index — the keeper's reveal set. Reading
   *  this is how the keeper knows exactly which seals to open and reveal. */
  async getBidders(roundId: number | bigint): Promise<string[]> {
    const tx = await this.#validatedContractCall(() =>
      this.contract.get_bidders({ round_id: normalizeRoundId(roundId) }),
    );
    return tx.result.unwrap();
  }

  async getBiddersV2(roundId: number | bigint): Promise<string[]> {
    const tx = await this.#validatedContractCall(() =>
      this.contract.get_bidders_v2({ round_id: normalizeRoundId(roundId) }),
    );
    return tx.result.unwrap();
  }

  /** Fetch a single page of bidders. Zero-based cursor; next_cursor = 0 means
   *  no more pages. Limit must be 1-100. */
  async getBiddersPage(
    roundId: number | bigint,
    cursor: number,
    limit: number,
  ): Promise<BiddersPage> {
    const tx = await this.#validatedContractCall(() =>
      this.contract.get_bidders_page({
        round_id: normalizeRoundId(roundId),
        cursor,
        limit,
      }),
    );
    return tx.result.unwrap();
  }

  /** Async generator that lazily pages through all bidders for a round.
   *  Fetches one page at a time, yielding each bidder individually. */
  async *bidders(roundId: number | bigint): AsyncGenerator<string> {
    let cursor = 0;
    const PAGE_SIZE = 100;
    do {
      const page = await this.getBiddersPage(roundId, cursor, PAGE_SIZE);
      for (const addr of page.data) yield addr;
      cursor = page.next_cursor;
    } while (cursor !== 0);
  }

  /** The sealed payload while it is still in Temporary storage; undefined once
   *  its TTL expires (by design shortly after the reveal window). Persistent
   *  bid state from `getBidState` remains for settlement either way. Seal TTL
   *  is extended on commit, when reveal opens, and on each observer read. */
  async getSeal(
    roundId: number | bigint,
    bidder: string,
  ): Promise<Seal | undefined> {
    const tx = await this.#validatedContractCall(() =>
      this.contract.get_seal({
        round_id: normalizeRoundId(roundId),
        bidder,
      }),
    );
    return tx.result ?? undefined;
  }

  async getSealV2(
    roundId: number | bigint,
    bidder: string,
  ): Promise<Seal | undefined> {
    const tx = await this.#validatedContractCall(() =>
      this.contract.get_seal_v2({
        round_id: normalizeRoundId(roundId),
        bidder,
      }),
    );
    return tx.result ?? undefined;
  }

  async getConfig(): Promise<GlobalConfig> {
    const tx = await this.#validatedContractCall(() => this.contract.get_config());
    return tx.result.unwrap();
  }

  /** Export a versioned canonical receipt for a round. Collects all on-chain
   *  state — round params, bidders, commitments, reveal validity, seal evidence
   *  (may be null if expired) — into a single portable document. */
  async exportReceipt(roundId: number | bigint): Promise<RoundReceipt> {
    const rid = normalizeRoundId(roundId);
    const [round, config] = await Promise.all([
      this.getRound(rid),
      this.getConfig(),
    ]);

    const bidders: string[] = [];
    for await (const addr of this.bidders(rid)) bidders.push(addr);

    const bids: RoundReceipt["bids"] = {};
    for (const bidder of bidders) {
      const [state, seal] = await Promise.all([
        this.getBidState(rid, bidder),
        this.getSeal(rid, bidder),
      ]);
      const commitment = toHex(state.commitment);
      // The nonce is now persisted on-chain at reveal time (revealed_nonce),
      // enabling offline receipt verifiers to recompute sha256(be16(value)‖nonce).
      const nonce = state.revealed_nonce ? toHex(state.revealed_nonce) : null;
      bids[bidder] = {
        commitment,
        escrow: state.escrow.toString(),
        revealedValue: state.revealed_value?.toString() ?? null,
        nonce,
        hashValid: null,
        valid: state.valid,
        settled: state.settled,
        evidence: {
          ciphertext: seal ? toHex(seal.ciphertext) : null,
          auditorBlob: seal ? toHex(seal.auditor_blob) : null,
        },
      };
    }

    return {
      version: 1,
      network: this.networkPassphrase,
      networkFingerprint: networkFingerprint(this.networkPassphrase),
      contractId: this.contractId,
      exportedAt: new Date().toISOString(),
      roundId: rid.toString(),
      itemRef: toHex(round.item_ref),
      revealRound: Number(round.reveal_round),
      clearingRule: round.clearing_rule.tag,
      commitDeadline: round.commit_deadline.toString(),
      revealDeadline: round.reveal_deadline.toString(),
      operator: round.operator,
      auditorPubkey: toHex(round.auditor_pubkey),
      bidders,
      bids,
      winner: round.winner ?? null,
      winningValue: round.winning_bid?.toString() ?? null,
      status: round.status.tag,
    };
  }

  /** Export a canonical Core v2 receipt from durable round and submission state. */
  async exportReceiptV2(roundId: number | bigint): Promise<CoreV2Receipt> {
    const rid = normalizeRoundId(roundId);
    const [round, config, bidders, policy] = await Promise.all([
      this.getRoundV2(rid),
      this.getConfig(),
      this.getBiddersV2(rid),
      this.getRoundPolicyV2(rid),
    ]);
    if (round.protocol_version !== 2 && round.protocol_version !== 3) {
      throw new SubRosaClientConfigError(`unsupported round protocol ${round.protocol_version}`);
    }
    if (round.protocol_version === 3 && !policy) {
      throw new SubRosaClientConfigError("v3 round requires its partner policy for receipt export");
    }
    const revealState = round.protocol_version === 3 ? await this.getRevealStateV3(rid) : undefined;
    const submissions: CoreV2Receipt["submissions"] = {};
    for (const bidder of bidders) {
      const [state, seal] = await Promise.all([
        this.getSubmissionV2(rid, bidder),
        this.getSealV2(rid, bidder),
      ]);
      submissions[bidder] = {
        commitment: toHex(state.commitment),
        escrow: state.escrow.toString(),
        revealedEnvelope: state.revealed_envelope
          ? toHex(state.revealed_envelope)
          : null,
        revealedAmount: state.revealed_amount?.toString() ?? null,
        valid: state.valid,
        settled: state.settled,
        evidence: {
          ciphertext: seal ? toHex(seal.ciphertext) : null,
          auditorBlob: seal ? toHex(seal.auditor_blob) : null,
        },
      };
    }

    return {
      version: round.protocol_version,
      protocolVersion: round.protocol_version,
      ...(revealState ? {
        revealPolicy: revealState.policy.tag === "Timed"
          ? { type: "timed" as const }
          : { type: "owner-triggered" as const, controller: round.operator, fallbackAt: revealState.policy.values[0].toString() },
        openedAt: revealState.opened_at?.toString() ?? null,
      } : {}),
      network: this.networkPassphrase,
      networkFingerprint: networkFingerprint(this.networkPassphrase),
      contractId: this.contractId,
      exportedAt: new Date().toISOString(),
      roundId: rid.toString(),
      itemRef: toHex(round.item_ref),
      schemaRef: toHex(round.schema_ref),
      mode: round.mode.tag,
      paymentAsset: round.payment_asset ?? null,
      lotAsset: round.lot_asset ?? null,
      lotAmount: round.lot_amount.toString(),
      revealRound: Number(round.reveal_round),
      drandGenesis: config.drand_genesis.toString(),
      drandPeriod: config.drand_period.toString(),
      clearingRule: round.clearing_rule.tag,
      commitDeadline: round.commit_deadline.toString(),
      revealDeadline: round.reveal_deadline.toString(),
      operator: round.operator,
      auditorPubkey: toHex(round.auditor_pubkey),
      maxParticipants: round.max_participants,
      policy: policy
        ? {
            enforced: true,
            fixedEscrow: policy.fixed_escrow.toString(),
            participation: policy.eligible_participants.length === 0
              ? "Open"
              : "Allowlist",
            eligibleParticipants: policy.eligible_participants,
          }
        : {
            enforced: false,
            fixedEscrow: null,
            participation: "Open",
            eligibleParticipants: [],
          },
      bidders,
      submissions,
      winner: round.winner ?? null,
      winningAmount: round.winning_bid.toString(),
      status: round.status.tag,
    };
  }
}
