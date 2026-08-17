export {
  SubRosaClient,
  type SubRosaClientConfig,
  type CreateRoundParams,
  type CommitParams,
  type RevealParams,
  type CreateRoundV2Params,
  type CreatePartnerRoundV2Params,
  type CommitV2Params,
  type RevealV2Params,
  type ClearingRuleTag,
  type RoundModeTag,
  MAX_V2_PARTICIPANTS,
} from "./client.js";
export { normalizeRoundId, normalizeSorobanContractId } from "./ids.js";
export {
  ASSET_AUCTION_SCHEMA_ID,
  ASSET_AUCTION_SCHEMA_REF,
  SEALED_PROPOSAL_SCHEMA_ID,
  SEALED_PROPOSAL_SCHEMA_REF,
  assetAuctionRound,
  sealedProposalRound,
  createAssetAuctionRound,
  createSealedProposalRound,
  encodeSealedProposal,
  decodeSealedProposal,
  sealAssetBid,
  sealProposal,
  type AssetAuctionRoundParams,
  type SealedProposalRoundParams,
  type SealAssetBidParams,
  type SealedProposal,
  type SealedProposalMilestone,
  type SealProposalParams,
} from "./templates.js";
export {
  type PreflightOperation,
  type PreflightResult,
  type PreflightSuccess,
  type PreflightFailureResult,
  type PreflightFeeEstimate,
  type PreflightResourceEstimate,
  evaluatePreflight,
  contractErrorCode,
} from "./preflight.js";
export {
  createOzChannelsSubmitter,
  createOzChannelsSubmitterFromEnv,
  type OzChannelsSubmitterConfig,
  type SubmittedTransaction,
  type SubmitSignedTransactionParams,
  type TransactionSubmitter,
} from "./submitter.js";
export {
  SubRosaClientConfigError,
  SubRosaMissingReturnValueError,
  SubRosaNetworkMismatchError,
  SubRosaPreflightError,
  SubRosaSubmitError,
  SubRosaTimeoutError,
  SubRosaTransactionError,
} from "./errors.js";
export type {
  NetworkMismatchErrorParams,
  PreflightFailureKind,
  SubRosaPreflightErrorParams,
  TimeoutErrorParams,
} from "./errors.js";
export {
  validateContractNetwork,
  type ContractNetworkValidationConfig,
  type NetworkValidationServer,
} from "./network.js";
export {
  SUB_ROSA_DEPLOYMENTS,
  contractExplorerUrl,
  isSubRosaNetwork,
  resolveSubRosaDeployment,
  transactionExplorerUrl,
  type DeploymentStatus,
  type ResolveDeploymentOptions,
  type ResolvedSubRosaDeployment,
  type SubRosaDeployment,
  type SubRosaNetwork,
} from "./deployments.js";

export {
  validateEncryptedBlob,
  tryDecodeHex,
  tryDecodeBase64,
  MAX_CIPHERTEXT_BYTES,
  MAX_AUDITOR_BLOB_BYTES,
  type BlobContentType,
  type BlobValidationIssue,
  type BlobValidationResult,
} from "./encrypted-blob.js";
export {
  MAINNET_ARTIFACTS,
  MAINNET_CONFIRM_PHRASE,
  MAINNET_DEPLOY_MIN_XLM_STROOPS,
  MAINNET_MICRO_MAX_ESCROW,
  MAINNET_MIN_FEE_RESERVE_STROOPS,
} from "./mainnet-artifacts.js";
export {
  AssetConfigError,
  validateAssetConfig,
  validateAssetConfigs,
  ASSET_FIXTURES,
  type AssetConfig,
  type AssetType,
} from "./asset-config.js";
export {
  assertMainnetConfirmed,
  assertMicroAmounts,
  assertReadinessForExecute,
  createSacBalanceReader,
  defaultMainnetReadinessInput,
  fetchContractWasmHash,
  formatReadinessReport,
  hasBlockingFailures,
  nativeXlmSacId,
  runMainnetReadiness,
  verifySettledRoundProof,
  type MainnetReadinessDeps,
  type MainnetReadinessInput,
  type MainnetReadinessReport,
  type ReadinessCheck,
  type ReadinessStatus,
} from "./mainnet-readiness.js";

export {
  serializeReceipt,
  parseReceipt,
  networkFingerprint,
  type RoundReceipt,
  type BidReceiptEntry,
  RECEIPT_VERSION,
} from "./receipt.js";
export {
  CORE_V2_RECEIPT_VERSION,
  parseReceiptV2,
  serializeReceiptV2,
  verifyReceiptV2,
  type CoreV2Receipt,
  type CoreV2SubmissionReceipt,
} from "./receipt-v2.js";
export {
  PUBLISHED_AUCTION_EVIDENCE_VERSION,
  parsePublishedAuctionEvidence,
  serializePublishedAuctionEvidence,
  verifyPublishedAuctionEvidence,
  type AuctionEvidencePhase,
  type AuctionEvidenceTransaction,
  type PublishedAuctionEvidence,
  type PublishedAuctionEvidenceIssue,
  type PublishedAuctionEvidenceVerification,
} from "./published-auction.js";
export {
  redactReceipt,
  type RedactOptions,
} from "./redact.js";
export {
  verifyReceipt,
  type VerificationIssue,
  type VerificationResult,
  type VerifyOptions,
  type Severity,
} from "./verify.js";

// Keeper status-API response shapes. Mirror services/keeper/src/status.ts.
export {
  type RoundStatus,
  type SettlementIndicator,
  type KeeperHealthState,
  type KeeperRoundStatusView,
  type KeeperServiceHealth,
  type KeeperStatusResponse,
  type KeeperHealthResponse,
  type ApiError,
} from "./status.js";

// Fetch client for the keeper status API.
export {
  KeeperStatusClient,
  StatusApiError,
  type StatusClientOptions,
  fetchKeeperStatus,
} from "./status-client.js";

// Re-export the generated contract types so consumers get spec-accurate shapes
// from a single import surface.
export {
  Client as RoundContract,
  Errors as RoundErrors,
  type Round,
  type RoundV2,
  type RoundPolicyV2,
  type RoundMode,
  type SettlementConfig,
  type BidState,
  type SubmissionStateV2,
  type BiddersPage,
  type Seal,
  type GlobalConfig,
  type ClearingRule,
  type Status,
  type DataKey,
} from "@sub-rosa/round-bindings";

// Partner-facing cryptography and Drand helpers. Keep this list explicit so
// the SDK stays a stable facade without exposing every tlock implementation detail.
export {
  generateAuditorKeypair,
  auditorPublicKey,
  sealIdentity,
  openIdentity,
  quicknet,
  chainInfo,
  currentRound,
  roundInSeconds,
  fetchRoundBeacon,
  fetchRoundSignature,
  QUICKNET_HASH,
  generateNonce,
  encodePayloadEnvelope,
  decodePayloadEnvelope,
  payloadCommitment,
  sealPayload,
  openPayload,
  PAYLOAD_ENVELOPE_VERSION,
  PAYLOAD_HEADER_BYTES,
  MAX_APPLICATION_PAYLOAD_BYTES,
  type AuditorKeypair,
  type DrandClient,
  type PayloadEnvelope,
  type SealPayloadParams,
  type SealedPayload,
} from "@sub-rosa/tlock";
