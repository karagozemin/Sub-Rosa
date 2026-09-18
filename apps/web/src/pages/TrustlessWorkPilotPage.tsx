import { drandRoundTime } from "@sub-rosa/tlock";
import { Buffer } from "buffer";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  getNetworkDetails,
  isConnected,
  requestAccess,
  signTransaction,
} from "@stellar/freighter-api";
import { StrKey } from "@stellar/stellar-sdk";
import {
  SEALED_PROPOSAL_SCHEMA_REF,
  serializeReceiptV2,
  sealProposal,
  type RoundV2,
  verifyReceiptV2,
} from "@sub-rosa/sdk";
import {
  encodePayloadEnvelope,
  fetchRoundSignature,
  generateAuditorKeypair,
  openPayload,
  quicknet,
  roundInSeconds,
} from "@sub-rosa/tlock";
import {
  ArrowRight,
  CheckCircle2,
  FileCheck2,
  Clock3,
  ExternalLink,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Upload,
  WalletCards,
  X,
} from "lucide-react";

import {
  CONTRACT_ID,
  LOGO_SRC,
  NETWORK,
  NETWORK_LABEL,
  RPC_URL,
  STELLAR_NETWORK,
  displayError,
  freighterError,
  resolveFreighterAddress,
  sha256Bytes,
  stellarExpertTxLink,
  useReadOnlyContract,
  useReadOnlySdk,
  useWalletContract,
} from "../lib/chain";
import { formatCountdown, useDrandCountdown } from "../hooks/useDrandCountdown";
import { isRevealAlreadyOpen, isSubmissionAlreadyRevealed } from "../lib/pilotConcurrency";
import { decodePilotSubmission, type PilotSubmissionView } from "../lib/pilotSubmission";
import { shortAddr, shortHash, usdc } from "../lib/format";
import { useToast } from "../ui/Toast";
import { ConfettiBurst } from "../ui/Confetti";
import {
  buildMultiReleaseEscrow,
  fundMultiReleaseEscrow,
  getEscrowByContractId,
  getEscrowsBySigner,
  hashSignedTransaction,
  readContractId,
  formatTrustlessWorkApiError,
  resolveTrustlessWorkConfig,
  resolveContractIdFromStellarTransaction,
  sendSignedTransaction,
  waitForTestnetTransactionStatus,
  waitForTestnetTransaction,
  trustlessWorkConfigIssues,
  type TrustlessWorkApiVersion,
  type TrustlessWorkDeployMultiReleasePayload,
  type TrustlessWorkEscrowSnapshot,
  type TrustlessWorkMilestoneInput,
  type TrustlessWorkRoleConfig,
  type TrustlessWorkTrustlineConfig,
  type TrustlessWorkSendTransactionResponse,
  type TrustlessWorkUnsignedTransactionResponse,
} from "../integrations/trustless-work";
import { trustlessWorkPilotRoundIdFromHash } from "../config/routing";

type PilotMode = "sample" | "live";
type PilotRole = "organizer" | "provider";
type PilotStatus = "collecting" | "ready" | "revealed" | "selected";
type DeadlinePreset = "2m" | "5m" | "1d";
type SignableTransaction<T> = { signAndSend: () => Promise<T> };

const STORAGE_KEY = "subrosa-trustless-work-pilot-v1";
const DEADLINE_OPTIONS: Array<{ value: DeadlinePreset; label: string; seconds: number }> = [
  { value: "2m", label: "2 min", seconds: 2 * 60 },
  { value: "5m", label: "5 min", seconds: 5 * 60 },
  { value: "1d", label: "1 day", seconds: 24 * 60 * 60 },
];
const TRUSTLESS_WORK_TESTNET_USDC_CONTRACT_ID = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
const TRUSTLESS_WORK_TESTNET_USDC_ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const MAX_NEXT_ROUND_PROBE = 256;
const REVEAL_GATE_SYNC_ATTEMPTS = 12;
const REVEAL_GATE_SYNC_DELAY_MS = 1500;

interface ProjectDraft {
  title: string;
  description: string;
  budget: string;
  deadlinePreset: DeadlinePreset;
}

interface ProposalMilestoneDraft {
  title: string;
  description: string;
  amount: string;
  receiver: string;
  delivery: string;
}

interface ProposalDraft {
  providerName: string;
  providerMeta: string;
  providerWallet: string;
  totalAmount: string;
  timelineDays: string;
  approach: string;
  team: string;
  deliverables: string;
  milestones: ProposalMilestoneDraft[];
}

interface ProposalDetails {
  totalAmount: number;
  timelineDays: number;
  approach: string;
  team: string;
  deliverables: string[];
  milestones: Array<{
    title: string;
    description: string;
    amount: number;
    receiver: string;
    delivery: string;
  }>;
}

interface ProposalRecord {
  id: string;
  provider: string;
  providerMeta: string;
  wallet: string;
  submittedAt: number;
  revealed: boolean;
  source: "sample" | "live" | "demo";
  data: ProposalDetails;
}

interface TrustlessWorkDraft {
  platformFee: string;
  approver: string;
  serviceProvider: string;
  platform: string;
  releaseSigner: string;
  disputeResolver: string;
  admin: string;
  observers: string;
  trustlineContractId: string;
  trustlineSymbol: string;
  trustlineAddress: string;
  receiverMemo: string;
}

interface TrustlessWorkReceipt {
  deployBuild?: TrustlessWorkUnsignedTransactionResponse | null;
  deploySubmit?: TrustlessWorkSendTransactionResponse | null;
  fundBuild?: TrustlessWorkUnsignedTransactionResponse | null;
  fundSubmit?: TrustlessWorkSendTransactionResponse | null;
  escrowContractId?: string | null;
  escrow?: TrustlessWorkEscrowSnapshot | null;
  refreshedAt?: number | null;
}

interface PersistedState {
  project: ProjectDraft;
  mode: PilotMode;
  role: PilotRole;
  deadlineAt: number;
  roundId: string | null;
  roundInput: string;
  selectedProposalId: string | null;
  proposals: ProposalRecord[];
  proposalDraft: ProposalDraft;
  trustlessWorkDraft: TrustlessWorkDraft;
  trustlessWorkReceipt: TrustlessWorkReceipt | null;
  transactionHashes: string[];
}

function deadlineSeconds(value: DeadlinePreset): number {
  return DEADLINE_OPTIONS.find((entry) => entry.value === value)?.seconds ?? 5 * 60;
}

function deadlineLabel(value: DeadlinePreset): string {
  return DEADLINE_OPTIONS.find((entry) => entry.value === value)?.label ?? "5 min";
}

function sampleWallet(seed: number): string {
  return StrKey.encodeEd25519PublicKey(Buffer.from(new Uint8Array(32).fill(seed)));
}

function nowMs(): number {
  return Date.now();
}

function makeMilestone(seed: number, title: string, amount: number, receiver: string, delivery: string): ProposalMilestoneDraft {
  return {
    title,
    description: title,
    amount: amount.toString(),
    receiver,
    delivery,
  };
}

function defaultProject(): ProjectDraft {
  return {
    title: "Build a Stellar merchant analytics dashboard",
    description:
      "Private selection workflow for a small analytics build with a visible reveal, then a Trustless Work multi-release escrow.",
    budget: "20",
    deadlinePreset: "5m",
  };
}

function defaultProposalDraft(): ProposalDraft {
  return {
    providerName: "Northstar Studio",
    providerMeta: "Product engineering",
    providerWallet: sampleWallet(30),
    totalAmount: "10",
    timelineDays: "21",
    approach: "Discovery, dashboard delivery, and security handoff.",
    team: "4 engineers + 1 auditor",
    deliverables: "Dashboard UX\nStellar data integration\nSecurity review",
    milestones: [
      makeMilestone(1, "UI / dashboard implementation", 3, sampleWallet(31), "2026-09-01"),
      makeMilestone(2, "Stellar data integration", 4, sampleWallet(31), "2026-09-10"),
      makeMilestone(3, "Security / final review", 3, sampleWallet(32), "2026-09-15"),
    ],
  };
}

function defaultTrustlessWorkRoleWallets(): string[] {
  return [40, 41, 42, 43, 44].map((seed) => sampleWallet(seed));
}

function shouldReplaceTrustlessWorkRole(value: string | undefined): boolean {
  const address = value?.trim();
  return !address || defaultTrustlessWorkRoleWallets().includes(address);
}

function trustlessWorkV1RoleAddress(value: string | undefined, signer: string): string {
  return shouldReplaceTrustlessWorkRole(value) ? signer : value!.trim();
}

function isPilotSampleWallet(value: string | undefined): boolean {
  const address = value?.trim();
  if (!address) return true;
  for (let seed = 30; seed <= 90; seed += 1) {
    if (address === sampleWallet(seed)) return true;
  }
  return false;
}

function resolveTrustlessWorkContractId(value: string | undefined): string {
  const contractId = value?.trim();
  return contractId && StrKey.isValidContract(contractId)
    ? contractId
    : TRUSTLESS_WORK_TESTNET_USDC_CONTRACT_ID;
}

function resolveTrustlessWorkIssuer(value: string | undefined): string {
  const address = value?.trim();
  return address && StrKey.isValidEd25519PublicKey(address)
    ? address
    : TRUSTLESS_WORK_TESTNET_USDC_ISSUER;
}

function resolveTrustlessWorkTrustline(
  draft: TrustlessWorkDraft,
  apiVersion: TrustlessWorkApiVersion = "v1",
): TrustlessWorkTrustlineConfig {
  const symbol = draft.trustlineSymbol.trim() || "USDC";
  const address = draft.trustlineAddress.trim();
  if (apiVersion === "v1") {
    return {
      symbol,
      address: address && StrKey.isValidEd25519PublicKey(address)
        ? address
        : TRUSTLESS_WORK_TESTNET_USDC_ISSUER,
    };
  }

  const contractId = draft.trustlineContractId.trim();
  if (contractId && StrKey.isValidContract(contractId)) {
    return { contractId };
  }

  if (symbol && address && StrKey.isValidEd25519PublicKey(address)) {
    return { symbol, address };
  }

  return { contractId: TRUSTLESS_WORK_TESTNET_USDC_CONTRACT_ID };
}

function trustlineSummary(trustline: TrustlessWorkTrustlineConfig): string {
  if (trustline.contractId) {
    const label = trustline.contractId === TRUSTLESS_WORK_TESTNET_USDC_CONTRACT_ID
      ? "Testnet USDC contract"
      : "Custom contract";
    return `${label} · ${shortAddr(trustline.contractId)}`;
  }
  if (trustline.symbol && trustline.address) {
    const label = trustline.address === TRUSTLESS_WORK_TESTNET_USDC_ISSUER
      ? "Testnet USDC issuer"
      : "Custom issuer";
    return `${trustline.symbol} / ${label} · ${shortWallet(trustline.address)}`;
  }
  return "Not configured";
}

function isRoundNotFoundError(error: unknown): boolean {
  const message = displayError(error);
  return (
    !message ||
    message.includes("RoundNotFound") ||
    message.includes("Error(Contract, #3)") ||
    message.includes("ContractError(3)") ||
    message.includes("Contract, #3")
  );
}

function isContractResultErr(value: unknown): boolean {
  return Boolean(
    value &&
    typeof value === "object" &&
    "error" in value,
  );
}

function transactionErrorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function isTxBadSeqError(error: unknown): boolean {
  const message = transactionErrorText(error);
  return (
    message.includes("txBadSeq") ||
    message.includes("tx_bad_seq") ||
    message.includes("\"value\":-5") ||
    message.includes("\"value\": -5")
  );
}

function isRevealGateNotReadyError(error: unknown): boolean {
  const message = transactionErrorText(error);
  return (
    message.includes("RevealNotOpen") ||
    message.includes("CommitNotClosed") ||
    message.includes("Error(Contract, #13)") ||
    message.includes("Error(Contract, #11)") ||
    message.includes("ContractError(13)") ||
    message.includes("ContractError(11)") ||
    message.includes("Contract, #13") ||
    message.includes("Contract, #11") ||
    message.includes("Reveal gate is still opening") ||
    message.includes("is still syncing") ||
    message.includes("got 425") ||
    message.includes("Error response fetching")
  );
}

function isRoundReadPendingError(error: unknown): boolean {
  const message = transactionErrorText(error);
  return (
    message.includes("not visible from the Stellar RPC yet") ||
    message.includes("Revealed submissions are still syncing") ||
    isRoundNotFoundError(error)
  );
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function roundInputIssue(value: string, nextRoundId: string | null): string | null {
  const input = value.trim();
  if (!input) return null;
  if (!/^\d+$/.test(input)) return "Round ID must be a whole number.";
  if (!nextRoundId) return null;
  const current = BigInt(input);
  const next = BigInt(nextRoundId);
  if (current < next) {
    return `Round #${input} already exists. This pilot only creates the next fresh round: #${nextRoundId}.`;
  }
  if (current > next) {
    return `Round IDs are assigned in order by the contract. The next fresh round is #${nextRoundId}.`;
  }
  return null;
}

function defaultTrustlessWorkDraft(selectedWallet = sampleWallet(31)): TrustlessWorkDraft {
  return {
    platformFee: "2",
    approver: sampleWallet(40),
    serviceProvider: selectedWallet,
    platform: sampleWallet(41),
    releaseSigner: sampleWallet(42),
    disputeResolver: sampleWallet(43),
    admin: sampleWallet(44),
    observers: "",
    trustlineContractId: resolveTrustlessWorkContractId(import.meta.env.VITE_TRUSTLESS_WORK_TRUSTLINE_CONTRACT_ID),
    trustlineSymbol: import.meta.env.VITE_TRUSTLESS_WORK_TRUSTLINE_SYMBOL?.trim() || "USDC",
    trustlineAddress: resolveTrustlessWorkIssuer(import.meta.env.VITE_TRUSTLESS_WORK_TRUSTLINE_ADDRESS),
    receiverMemo: "",
  };
}

function seedSampleProposals(timestamp = nowMs()): ProposalRecord[] {
  const samples: Array<[string, string, string, ProposalDetails]> = [
    [
      "provider-a",
      "Northstar Studio",
      "Product engineering",
      {
        totalAmount: 1500,
        timelineDays: 21,
        approach: "Phased delivery with a final security checkpoint.",
        team: "4 engineers + 1 auditor",
        deliverables: ["Dashboard UX", "Stellar data sync", "Security review"],
        milestones: [
          {
            title: "UI / dashboard implementation",
            description: "Frontend screens, filters, and export flow.",
            amount: 400,
            receiver: sampleWallet(31),
            delivery: "2026-09-01",
          },
          {
            title: "Stellar data integration",
            description: "Metrics pipeline and ingest connectors.",
            amount: 700,
            receiver: sampleWallet(31),
            delivery: "2026-09-10",
          },
          {
            title: "Security / final review",
            description: "Threat review and release signoff.",
            amount: 400,
            receiver: sampleWallet(32),
            delivery: "2026-09-15",
          },
        ],
      },
    ],
    [
      "provider-b",
      "Cedar Systems",
      "Data delivery",
      {
        totalAmount: 1700,
        timelineDays: 24,
        approach: "Longer integration window with extra QA.",
        team: "3 engineers + 1 designer",
        deliverables: ["Analytics widgets", "Export jobs", "Role-based access"],
        milestones: [
          {
            title: "Data model and ingestion",
            description: "Schema, sync jobs, and staging metrics.",
            amount: 600,
            receiver: sampleWallet(33),
            delivery: "2026-09-06",
          },
          {
            title: "UX and reporting",
            description: "Operator views and saved reports.",
            amount: 700,
            receiver: sampleWallet(33),
            delivery: "2026-09-13",
          },
          {
            title: "Launch hardening",
            description: "QA and release notes.",
            amount: 400,
            receiver: sampleWallet(34),
            delivery: "2026-09-18",
          },
        ],
      },
    ],
    [
      "provider-c",
      "Harbor Labs",
      "Implementation",
      {
        totalAmount: 1400,
        timelineDays: 18,
        approach: "Lean build with a tight milestone cadence.",
        team: "2 engineers + 1 auditor",
        deliverables: ["Admin dashboard", "Stellar ledger views", "Final review"],
        milestones: [
          {
            title: "Admin dashboard",
            description: "Project, proposal, and escrow views.",
            amount: 500,
            receiver: sampleWallet(35),
            delivery: "2026-09-03",
          },
          {
            title: "Ledger integration",
            description: "Stellar activity and proof screens.",
            amount: 500,
            receiver: sampleWallet(35),
            delivery: "2026-09-09",
          },
          {
            title: "Final review",
            description: "Security review and documentation.",
            amount: 400,
            receiver: sampleWallet(36),
            delivery: "2026-09-14",
          },
        ],
      },
    ],
  ];

  return samples.map(([id, provider, providerMeta, data], index) => ({
    id,
    provider,
    providerMeta,
    wallet: data.milestones[0]?.receiver ?? sampleWallet(50 + index),
    submittedAt: timestamp + index * 1000,
    revealed: false,
    source: "sample",
    data,
  }));
}

function loadPersistedState(): Partial<PersistedState> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<PersistedState>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function savePersistedState(state: PersistedState): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function parseIntOrZero(value: string): number {
  const normalized = value.trim().replace(/,/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseDeliverables(value: string): string[] {
  return value
    .split(/\n+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseMilestones(draft: ProposalDraft): ProposalDetails["milestones"] {
  const milestones = draft.milestones.map((milestone, index) => {
    const amount = parseIntOrZero(milestone.amount);
    if (!milestone.title.trim()) {
      throw new Error(`Milestone ${index + 1} title is required`);
    }
    if (!milestone.description.trim()) {
      throw new Error(`Milestone ${index + 1} description is required`);
    }
    if (amount <= 0) {
      throw new Error(`Milestone ${index + 1} amount must be positive`);
    }
    if (!StrKey.isValidEd25519PublicKey(milestone.receiver.trim())) {
      throw new Error(`Milestone ${index + 1} receiver must be a valid Stellar public key`);
    }
    if (!milestone.delivery.trim()) {
      throw new Error(`Milestone ${index + 1} delivery date is required`);
    }
    return {
      title: milestone.title.trim(),
      description: milestone.description.trim(),
      amount,
      receiver: milestone.receiver.trim(),
      delivery: milestone.delivery.trim(),
    };
  });
  if (milestones.length < 1 || milestones.length > 10) {
    throw new Error("Milestone count must be between 1 and 10");
  }
  return milestones;
}

function buildProposalDetails(draft: ProposalDraft): ProposalDetails {
  const totalAmount = parseIntOrZero(draft.totalAmount);
  if (totalAmount <= 0) throw new Error("Total amount must be positive");
  const timelineDays = parseIntOrZero(draft.timelineDays);
  if (timelineDays <= 0) throw new Error("Timeline must be a positive whole number");
  const deliverables = parseDeliverables(draft.deliverables);
  if (deliverables.length < 1) throw new Error("At least one deliverable is required");
  const milestones = parseMilestones(draft);
  const milestoneTotal = milestones.reduce((sum, milestone) => sum + milestone.amount, 0);
  if (milestoneTotal !== totalAmount) {
    throw new Error("Milestone amounts must add up to the total amount");
  }
  return {
    totalAmount,
    timelineDays,
    approach: draft.approach.trim(),
    team: draft.team.trim(),
    deliverables,
    milestones,
  };
}

function sampleStatusLabel(status: PilotStatus): string {
  return {
    collecting: "Collecting proposals",
    ready: "Deadline reached",
    revealed: "Proposals revealed",
    selected: "Proposal selected",
  }[status];
}

function formatDeadline(timestamp: number, now: number): string {
  if (timestamp <= now) return "Deadline passed";
  const remaining = Math.max(0, Math.ceil((timestamp - now) / 1000));
  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  return `${minutes}m ${seconds.toString().padStart(2, "0")}s remaining`;
}

function proposalRows(proposal: ProposalRecord): Array<[string, string]> {
  return [
    ["Total", `${proposal.data.totalAmount.toLocaleString()} USDC`],
    ["Timeline", `${proposal.data.timelineDays} days`],
    ["Team", proposal.data.team],
    ["Deliverables", proposal.data.deliverables.join(" | ")],
  ];
}

function sampleMilestoneRows(proposal: ProposalRecord): Array<[string, string]> {
  return proposal.data.milestones.map((milestone) => [
    milestone.title,
    `${usdc(milestone.amount)} -> ${shortAddr(milestone.receiver)}${milestone.delivery ? `, ${milestone.delivery}` : ""}`,
  ]);
}

function toReceiptOnlyProposal(
  proposal: ProposalRecord,
  selectedProviderMeta: string,
): {
  timelineDays: number;
  approach: string;
  totalAmount: number;
  currency: string;
  deliverables: string[];
  milestones: Array<{
    title: string;
    description: string;
    amount: number;
    receiver: string;
    delivery: string;
  }>;
  metadata: Record<string, string>;
} {
  return {
    timelineDays: proposal.data.timelineDays,
    approach: proposal.data.approach,
    totalAmount: proposal.data.totalAmount,
    currency: "USDC",
    deliverables: proposal.data.deliverables,
    milestones: proposal.data.milestones,
    metadata: {
      provider: proposal.provider,
      providerMeta: selectedProviderMeta,
      team: proposal.data.team,
    },
  };
}

function proposalSourceLabel(source: ProposalRecord["source"]): string {
  return source === "live" ? "Live" : source === "sample" ? "Sample" : "Demo";
}

function txHashFromResult(result: unknown): string | null {
  const hash = (result as { sendTransactionResponse?: { hash?: unknown } })
    .sendTransactionResponse?.hash;
  return typeof hash === "string" && hash ? hash : null;
}

function txHashFromError(error: unknown): string | null {
  const message = transactionErrorText(error);
  const match = message.match(/"hash"\s*:\s*"([a-f0-9]{64})"/i) ?? message.match(/\bhash\s*[:=]\s*["']?([a-f0-9]{64})/i);
  return match?.[1] ?? null;
}

function isRetryableNetworkSendError(error: unknown): boolean {
  const message = transactionErrorText(error);
  return /TRY_AGAIN_LATER|try_again_later|Sending the transaction to the network failed/i.test(message);
}

async function sendTrustlessWorkTransaction(
  config: NonNullable<ReturnType<typeof resolveTrustlessWorkConfig>>,
  signedXdr: string,
): Promise<TrustlessWorkSendTransactionResponse> {
  const localTxHash = hashSignedTransaction(signedXdr, NETWORK);
  try {
    const response = await sendSignedTransaction(config, signedXdr);
    const txHash = response.txHash ?? localTxHash;
    return { ...response, txHash };
  } catch (error) {
    const message = displayError(error);
    if (config.apiVersion !== "v1" || !/resultMetaXdr|result meta xdr|transaction response is missing/i.test(message)) {
      throw error;
    }

    const txHash = localTxHash;
    const submitted = await waitForTestnetTransaction(txHash);
    if (!submitted) {
      throw new Error(`Trustless Work returned incomplete transaction metadata and Testnet could not find the transaction yet. Retry in a few seconds. Hash: ${txHash}`);
    }
    return {
      txHash,
      status: "submitted",
      code: "STELLAR_TX_SUBMITTED_INDEXER_LAGGING",
      message: "Transaction is on Stellar Testnet; Trustless Work metadata is still catching up.",
    };
  }
}

function trustlessWorkRolesFromDraft(
  draft: TrustlessWorkDraft,
  proposal: ProposalRecord,
): TrustlessWorkRoleConfig {
  return {
    approvers: draft.approver
      .split(/[\s,]+/)
      .map((entry) => entry.trim())
      .filter(Boolean),
    serviceProviders: [draft.serviceProvider.trim() || proposal.wallet],
    platform: draft.platform.trim(),
    releaseSigners: draft.releaseSigner
      .split(/[\s,]+/)
      .map((entry) => entry.trim())
      .filter(Boolean),
    disputeResolvers: draft.disputeResolver
      .split(/[\s,]+/)
      .map((entry) => entry.trim())
      .filter(Boolean),
    admin: draft.admin.trim(),
    observers: draft.observers
      .split(/[\s,]+/)
      .map((entry) => entry.trim())
      .filter(Boolean),
  };
}

function buildTrustlessWorkPayload(
  project: ProjectDraft,
  proposal: ProposalRecord,
  draft: TrustlessWorkDraft,
  apiVersion: TrustlessWorkApiVersion,
  signer: string,
  engagementId: string,
): TrustlessWorkDeployMultiReleasePayload {
  let roles = trustlessWorkRolesFromDraft(draft, proposal);
  if (apiVersion === "v1") {
    const fallbackWallet = proposal.source === "live" ? proposal.wallet : signer;
    const serviceProvider = isPilotSampleWallet(roles.serviceProviders[0])
      ? fallbackWallet
      : roles.serviceProviders[0]?.trim() || fallbackWallet;
    roles = {
      approvers: [trustlessWorkV1RoleAddress(roles.approvers[0], signer)],
      serviceProviders: [serviceProvider],
      platform: trustlessWorkV1RoleAddress(roles.platform, signer),
      releaseSigners: [trustlessWorkV1RoleAddress(roles.releaseSigners[0], signer)],
      disputeResolvers: [trustlessWorkV1RoleAddress(roles.disputeResolvers[0], signer)],
      admin: trustlessWorkV1RoleAddress(roles.admin, signer),
      observers: [],
    };
  }
  const milestones = proposal.data.milestones.map((milestone) => ({
    description: `${milestone.title} - ${milestone.description}`,
    amount: milestone.amount,
    receiver: apiVersion === "v1" && isPilotSampleWallet(milestone.receiver)
      ? (proposal.source === "live" ? proposal.wallet : signer)
      : milestone.receiver,
  }));

  return {
    signer,
    engagementId,
    title: project.title,
    description: project.description,
    roles,
    platformFee: parseIntOrZero(draft.platformFee),
    milestones,
    trustline: resolveTrustlessWorkTrustline(draft, apiVersion),
    ...(draft.receiverMemo.trim()
      ? { receiverMemo: parseIntOrZero(draft.receiverMemo) }
      : {}),
  };
}

function emptyReceipt(): TrustlessWorkReceipt {
  return {
    deployBuild: null,
    deploySubmit: null,
    fundBuild: null,
    fundSubmit: null,
    escrowContractId: null,
    escrow: null,
    refreshedAt: null,
  };
}

function initialState(): PersistedState {
  const saved = loadPersistedState();
  const project = saved.project ?? defaultProject();
  const proposals = saved.proposals?.length ? saved.proposals : seedSampleProposals();
  const selectedProposalId = saved.selectedProposalId ?? proposals[0]?.id ?? null;
  const selectedProposal = proposals.find((entry) => entry.id === selectedProposalId);
  const proposalDraft = saved.proposalDraft ?? defaultProposalDraft();
  const trustlessWorkDraft = saved.trustlessWorkDraft
    ? {
        ...saved.trustlessWorkDraft,
        trustlineContractId: resolveTrustlessWorkContractId(saved.trustlessWorkDraft.trustlineContractId),
        trustlineSymbol: saved.trustlessWorkDraft.trustlineSymbol.trim() || "USDC",
        trustlineAddress: resolveTrustlessWorkIssuer(saved.trustlessWorkDraft.trustlineAddress),
      }
    : defaultTrustlessWorkDraft(selectedProposal?.wallet);
  return {
    project,
    mode: saved.mode ?? "sample",
    role: saved.role ?? "organizer",
    deadlineAt: saved.deadlineAt ?? nowMs() + deadlineSeconds(project.deadlinePreset) * 1000,
    roundId: saved.roundId ?? null,
    roundInput: saved.roundInput ?? "",
    selectedProposalId,
    proposals,
    proposalDraft,
    trustlessWorkDraft,
    trustlessWorkReceipt: saved.trustlessWorkReceipt ?? emptyReceipt(),
    transactionHashes: saved.transactionHashes ?? [],
  };
}

function shortWallet(value: string | undefined): string {
  if (!value) return "Not set";
  return shortAddr(value);
}

export function TrustlessWorkPilotPage({ goHome }: { goHome: () => void }) {
  const toast = useToast();
  const saved = useMemo(initialState, []);
  const [project, setProject] = useState<ProjectDraft>(saved.project);
  const [mode, setMode] = useState<PilotMode>(saved.mode);
  const [role, setRole] = useState<PilotRole>(saved.role);
  const [deadlineAt, setDeadlineAt] = useState(saved.deadlineAt);
  const [roundId, setRoundId] = useState<string | null>(saved.roundId);
  const [roundInput, setRoundInput] = useState(saved.roundInput);
  const [selectedProposalId, setSelectedProposalId] = useState<string | null>(saved.selectedProposalId);
  const [proposals, setProposals] = useState<ProposalRecord[]>(saved.proposals);
  const [proposalDraft, setProposalDraft] = useState<ProposalDraft>(saved.proposalDraft);
  const [trustlessWorkDraft, setTrustlessWorkDraft] = useState<TrustlessWorkDraft>(saved.trustlessWorkDraft);
  const [trustlessWorkReceipt, setTrustlessWorkReceipt] = useState<TrustlessWorkReceipt>(saved.trustlessWorkReceipt ?? emptyReceipt());
  const [transactionHashes, setTransactionHashes] = useState<string[]>(saved.transactionHashes);
  const [address, setAddress] = useState<string | null>(null);
  const [round, setRound] = useState<RoundV2 | null>(null);
  const [loadedRoundId, setLoadedRoundId] = useState<string | null>(null);
  const [liveProposals, setLiveProposals] = useState<ProposalRecord[]>([]);
  const [liveLoadError, setLiveLoadError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [confettiTick, setConfettiTick] = useState(0);
  const previousComplete = useRef<boolean | null>(null);
  const [roundProbeBusy, setRoundProbeBusy] = useState(false);
  const [nextLiveRoundId, setNextLiveRoundId] = useState<string | null>(null);
  const [roundInputWarning, setRoundInputWarning] = useState("");
  const [now, setNow] = useState(nowMs());
  const [copied, setCopied] = useState(false);
  const [hashRoundId, setHashRoundId] = useState(() => roomHashRoundId());
  const contract = useWalletContract(address);
  const reader = useReadOnlyContract();
  const sdk = useReadOnlySdk();
  const refreshRequest = useRef(0);
  const liveProposalCount = useRef(0);
  const escrowRecoveryRequest = useRef<string | null>(null);
  const selectionPanelRef = useRef<HTMLElement | null>(null);
  const handoffPanelRef = useRef<HTMLElement | null>(null);
  const twConfig = resolveTrustlessWorkConfig();
  const twConfigIssues = trustlessWorkConfigIssues();
  const twApiVersion = twConfig?.apiVersion ?? "v1";
  const isTrustlessWorkV1 = twApiVersion === "v1";
  const liveRoundId = roundId;
  const revealCountdown = useDrandCountdown(round ? Number(round.reveal_round) : 0);
  const selectedProposal = (mode === "live" ? liveProposals : proposals).find((entry) => entry.id === selectedProposalId) ?? null;
  const activeRoundReady = mode !== "live" || Boolean(round && liveRoundId && loadedRoundId === liveRoundId);
  const deadlinePassed = mode === "live"
    ? Boolean(activeRoundReady && round && (round.status.tag !== "Open" || Number(round.commit_deadline) * 1000 <= now))
    : deadlineAt <= now;
  const revealed = mode === "live"
    ? Boolean(activeRoundReady && round && (round.status.tag === "Revealing" || round.status.tag === "Cleared" || round.status.tag === "Settled"))
    : proposals.some((entry) => entry.revealed);
  const roundDeadlineAt = mode === "live" && activeRoundReady && round ? Number(round.commit_deadline) * 1000 : deadlineAt;
  const roundCountdown = formatDeadline(roundDeadlineAt, now);
  const liveSubmissionOpen = mode !== "live" || Boolean(activeRoundReady && round && round.status.tag === "Open" && Number(round.commit_deadline) * 1000 > now);
  const liveBidderCount = activeRoundReady ? round?.bidders.length ?? 0 : 0;
  const participantCount = mode === "live" ? liveBidderCount : proposals.length;
  const liveProposalDataPending = Boolean(
    mode === "live" &&
    revealed &&
    participantCount > 0 &&
    liveProposals.length < participantCount,
  );
  const currentRoundInputIssue = mode === "live"
    ? roundInputIssue(roundInput, nextLiveRoundId)
    : null;
  const status: PilotStatus = selectedProposal
    ? "selected"
    : revealed
      ? "revealed"
      : deadlinePassed
        ? "ready"
        : "collecting";
  const pilotComplete = Boolean(trustlessWorkReceipt.fundSubmit?.txHash || trustlessWorkReceipt.fundSubmit?.status);

  useEffect(() => {
    if (previousComplete.current === false && pilotComplete) {
      window.scrollTo({ top: 0, behavior: "smooth" });
      setConfettiTick((current) => current + 1);
    }
    previousComplete.current = pilotComplete;
  }, [pilotComplete]);
  const activeTxHashes = transactionHashes.length > 0 ? transactionHashes : saved.transactionHashes;
  const activeLiveRoundId = hashRoundId || liveRoundId;
  const connectedWalletIsRoundOperator = Boolean(activeRoundReady && round && address && round.operator === address);
  const connectedWalletAlreadySubmitted = Boolean(activeRoundReady && round && address && round.bidders.includes(address));
  const liveProviderRoundMessage = activeRoundReady
    ? connectedWalletAlreadySubmitted
      ? "This wallet is already counted as 1 participant. Submitting again updates the same sealed proposal."
      : connectedWalletIsRoundOperator
        ? "This is the organizer wallet. For the clean pilot flow, switch Freighter to a provider wallet before submitting."
        : liveLoadError || "Round data is ready for provider submission."
    : liveLoadError || "Load the live round before submitting a private proposal.";
  const revealActionReady = Boolean(
    mode === "live" &&
    activeRoundReady &&
    round &&
    round.status.tag !== "Open"
      ? true
      : mode === "live" && activeRoundReady && round && revealCountdown.published,
  );
  const revealButtonLabel = busy === "reveal"
    ? "Revealing..."
    : revealActionReady
      ? "Open + reveal on-chain"
      : `Reveal in ${formatCountdown(revealCountdown.secondsRemaining)}`;

  function scrollToSelectionPanel() {
    window.setTimeout(() => {
      selectionPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 100);
  }

  function scrollToHandoffPanel() {
    window.setTimeout(() => {
      handoffPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 100);
  }

  useEffect(() => {
    savePersistedState({
      project,
      mode,
      role,
      deadlineAt,
      roundId,
      roundInput,
      selectedProposalId,
      proposals,
      proposalDraft,
      trustlessWorkDraft,
      trustlessWorkReceipt,
      transactionHashes,
    });
  }, [
    project,
    mode,
    role,
    deadlineAt,
    roundId,
    roundInput,
    selectedProposalId,
    proposals,
    proposalDraft,
    trustlessWorkDraft,
    trustlessWorkReceipt,
    transactionHashes,
  ]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(nowMs()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const onHashChange = () => setHashRoundId(roomHashRoundId());
    window.addEventListener("hashchange", onHashChange);
    onHashChange();
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    if (!hashRoundId) return;
    if (hashRoundId === liveRoundId && loadedRoundId === hashRoundId) return;
    refreshRequest.current += 1;
    setMode("live");
    setRoundId(hashRoundId);
    setRound(null);
    setLoadedRoundId(null);
    setLiveProposals([]);
    setSelectedProposalId(null);
    setLiveLoadError(`Loading live round #${hashRoundId}...`);
    if (reader) {
      void refreshLiveWithRetry(hashRoundId).catch((error) => {
        toast.push("error", "Live round load failed", displayError(error));
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hashRoundId, reader]);

  useEffect(() => {
    if (!selectedProposal) return;
    setTrustlessWorkDraft((current) => (
      current.serviceProvider.trim() === selectedProposal.wallet
        ? current
        : { ...current, serviceProvider: selectedProposal.wallet }
    ));
  }, [selectedProposal?.wallet]);

  useEffect(() => {
    const txHash = trustlessWorkReceipt.deploySubmit?.txHash;
    if (!twConfig || !address || !txHash || trustlessWorkReceipt.escrowContractId) return;
    const recoveryKey = `${address}:${txHash}`;
    if (escrowRecoveryRequest.current === recoveryKey) return;
    escrowRecoveryRequest.current = recoveryKey;
    const engagementId = roundId
      ? `sub-rosa-round-${roundId}`
      : `sub-rosa-sample-${project.title.toLowerCase().replace(/\s+/g, "-")}`;
    void syncTrustlessWorkEscrow(null, address, engagementId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, roundId, project.title, trustlessWorkReceipt.deploySubmit?.txHash, trustlessWorkReceipt.escrowContractId, twConfig?.baseUrl]);

  useEffect(() => {
    if (!address || !isTrustlessWorkV1) return;
    setTrustlessWorkDraft((current) => {
      let changed = false;
      const next = { ...current };
      const replaceRole = (field: "approver" | "platform" | "releaseSigner" | "disputeResolver" | "admin") => {
        if (shouldReplaceTrustlessWorkRole(next[field])) {
          next[field] = address;
          changed = true;
        }
      };
      replaceRole("approver");
      replaceRole("platform");
      replaceRole("releaseSigner");
      replaceRole("disputeResolver");
      replaceRole("admin");
      if (
        shouldReplaceTrustlessWorkRole(next.serviceProvider) ||
        (selectedProposal?.source !== "live" && next.serviceProvider.trim() === selectedProposal?.wallet)
      ) {
        next.serviceProvider = selectedProposal?.source === "live" ? selectedProposal.wallet : address;
        changed = true;
      }
      if (!StrKey.isValidEd25519PublicKey(next.trustlineAddress.trim())) {
        next.trustlineAddress = TRUSTLESS_WORK_TESTNET_USDC_ISSUER;
        changed = true;
      }
      return changed ? next : current;
    });
  }, [address, isTrustlessWorkV1, selectedProposal?.source, selectedProposal?.wallet]);

  useEffect(() => {
    if (mode !== "live") return;
    if (selectedProposal) return;
    if (liveProposals.length !== 1) return;
    setSelectedProposalId(liveProposals[0].id);
  }, [mode, liveProposals, selectedProposal]);

  useEffect(() => {
    if (mode === "live" && reader && liveRoundId && !hashRoundId) {
      void refreshLiveWithRetry(liveRoundId).catch((error) => {
        toast.push("error", "Live round load failed", displayError(error));
      });
    }
  }, [mode, reader, liveRoundId, hashRoundId]);

  useEffect(() => {
    if (mode === "live" && reader) {
      void syncNextLiveRoundId({ syncInput: !roundInput.trim() }).catch((error) => {
        toast.push("error", "Next round check failed", displayError(error));
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, reader]);

  function roomHashRoundId(): string {
    return trustlessWorkPilotRoundIdFromHash(window.location.hash);
  }

  function rememberTransaction(hash: string | null | undefined) {
    if (!hash) return;
    setTransactionHashes((current) => Array.from(new Set([...current, hash])));
  }

  async function signAndSendWithSequenceRetry<T>(
    buildTransaction: () => Promise<SignableTransaction<T>>,
  ): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const tx = await buildTransaction();
        return await tx.signAndSend();
      } catch (error) {
        lastError = error;
        if (!isTxBadSeqError(error) || attempt === 2) throw error;
        toast.push(
          "info",
          "Wallet sequence refreshed",
          "Retrying with the latest Stellar account sequence.",
        );
        await wait(900);
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error(displayError(lastError));
  }

  async function roundExists(target: bigint): Promise<boolean> {
    if (!reader) return false;
    try {
      const v2 = await reader.get_round_v2({ round_id: target });
      if (isContractResultErr(v2.result)) return false;
      v2.result.unwrap();
      return true;
    } catch (error) {
      if (!isRoundNotFoundError(error)) throw error;
      return false;
    }
  }

  async function findNextLiveRoundId(): Promise<string> {
    for (let id = 1n; id <= BigInt(MAX_NEXT_ROUND_PROBE); id += 1n) {
      if (!(await roundExists(id))) return id.toString();
    }
    throw new Error(`Could not find a free round ID in the first ${MAX_NEXT_ROUND_PROBE} rounds.`);
  }

  async function syncNextLiveRoundId(options: { syncInput?: boolean } = {}): Promise<string | null> {
    if (!reader) return null;
    setRoundProbeBusy(true);
    try {
      const probedNext = await findNextLiveRoundId();
      const activeMinimum = activeLiveRoundId && /^\d+$/.test(activeLiveRoundId)
        ? (BigInt(activeLiveRoundId) + 1n).toString()
        : null;
      const next = activeMinimum && BigInt(probedNext) < BigInt(activeMinimum)
        ? activeMinimum
        : probedNext;
      const nextInput = options.syncInput ? next : roundInput;
      setNextLiveRoundId(next);
      if (options.syncInput) setRoundInput(next);
      setRoundInputWarning(roundInputIssue(nextInput, next) ?? "");
      return next;
    } finally {
      setRoundProbeBusy(false);
    }
  }

  function updateRoundInput(value: string) {
    setRoundInput(value);
    setRoundInputWarning(roundInputIssue(value, nextLiveRoundId) ?? "");
  }

  function refreshSuggestedRoundInput() {
    void syncNextLiveRoundId({ syncInput: true }).catch((error) => {
      toast.push("error", "Next round check failed", displayError(error));
    });
  }

  async function ensureFreshRoundInput(): Promise<boolean> {
    const next = nextLiveRoundId ?? await syncNextLiveRoundId();
    const issue = roundInputIssue(roundInput.trim() || next || "", next);
    if (issue) {
      setRoundInputWarning(issue);
      toast.push("error", "Fresh round required", issue);
      return false;
    }
    return true;
  }

  async function connect() {
    setBusy("connect");
    try {
      const connected = await isConnected();
      if (!connected.isConnected) throw new Error("Freighter is not available");
      const access = await requestAccess();
      const error = freighterError(access);
      if (error) throw new Error(error);
      const nextAddress = await resolveFreighterAddress(access);
      const network = await getNetworkDetails();
      if (network.networkPassphrase !== NETWORK) {
        throw new Error(`Switch Freighter to the configured network (${NETWORK_LABEL})`);
      }
      setAddress(nextAddress);
      if (role === "provider") {
        setProposalDraft((current) => ({
          ...current,
          providerWallet: nextAddress,
          milestones: current.milestones.map((milestone) => (
            isPilotSampleWallet(milestone.receiver)
              ? { ...milestone, receiver: nextAddress }
              : milestone
          )),
        }));
      }
      toast.push("success", "Wallet connected", shortAddr(nextAddress));
    } catch (error) {
      toast.push("error", "Wallet connection failed", displayError(error));
    } finally {
      setBusy(null);
    }
  }

  async function refreshLive(target = liveRoundId): Promise<RoundV2 | null> {
    if (!reader || !target || !/^\d+$/.test(target)) return null;
    const request = ++refreshRequest.current;
    const rid = BigInt(target);
    try {
      const roundTx = await reader.get_round_v2({ round_id: rid });
      if (isContractResultErr(roundTx.result)) {
        throw new Error(`Round #${target} is not visible from the Stellar RPC yet.`);
      }
      const nextRound = roundTx.result.unwrap();
      if (request !== refreshRequest.current) return null;
      setRound(nextRound);
      setLoadedRoundId(target);
      setDeadlineAt(Number(nextRound.commit_deadline) * 1000);
      setRoundId(target);
      setLiveLoadError("");

      const revealed = await Promise.all(
        nextRound.bidders.map(async (bidder) => {
          try {
            const state = (await reader.get_submission_v2({ round_id: rid, bidder })).result.unwrap();
            if (state.revealed_envelope == null) return null;
            return liveProposalFromSubmission(
              decodePilotSubmission(
                bidder,
                nextRound.mode.tag,
                new Uint8Array(state.revealed_envelope),
                state.valid,
              ),
            );
          } catch {
            return null;
          }
        }),
      );
      if (request !== refreshRequest.current) return null;
      const revealedEntries = revealed.filter((entry): entry is ProposalRecord => entry !== null);
      liveProposalCount.current = revealedEntries.length;
      setLiveProposals(revealedEntries);
      setProposals((current) => (
        current.some((entry) => entry.source === "live")
          ? current.filter((entry) => entry.source !== "live").concat(revealedEntries)
          : current.concat(revealedEntries)
      ));
      return nextRound;
    } catch (error) {
      if (request === refreshRequest.current) {
        setLiveLoadError(displayError(error) || `Round #${target} could not be loaded.`);
        if (target === liveRoundId) {
          liveProposalCount.current = 0;
          setRound(null);
          setLoadedRoundId(null);
          setLiveProposals([]);
        }
      }
      throw error;
    }
  }

  async function refreshLiveWithRetry(
    target = liveRoundId,
    options: { attempts?: number; delayMs?: number; waitForReveals?: boolean } = {},
  ): Promise<RoundV2 | null> {
    if (!target) return null;
    const attempts = options.attempts ?? 8;
    const delayMs = options.delayMs ?? 1250;
    let lastError: unknown;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const nextRound = await refreshLive(target);
        if (
          options.waitForReveals &&
          nextRound &&
          nextRound.bidders.length > 0 &&
          liveProposalCount.current < nextRound.bidders.length
        ) {
          throw new Error("Revealed submissions are still syncing from Stellar RPC.");
        }
        return nextRound;
      } catch (error) {
        lastError = error;
        if (!isRoundReadPendingError(error) || attempt === attempts - 1) throw error;
        setLiveLoadError(`Round #${target} was created. Waiting for Stellar RPC to catch up...`);
        await wait(delayMs);
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error(displayError(lastError));
  }

  async function reloadActiveRound() {
    const target = activeLiveRoundId;
    if (!target) {
      toast.push("error", "Live round missing", "Create a live round or open the copied round link first.");
      return;
    }
    setBusy("load-round");
    try {
      await refreshLiveWithRetry(target);
      toast.push("success", "Live round loaded", `ReceiptOnly round #${target}`);
    } catch (error) {
      toast.push("error", "Live round load failed", displayError(error));
    } finally {
      setBusy(null);
    }
  }

  async function requireLoadedOpenRound(target: string): Promise<RoundV2> {
    const nextRound = await refreshLiveWithRetry(target, { attempts: 12, delayMs: 1000 });
    if (!nextRound) throw new Error(`Round #${target} is still loading. Wait a moment, then reload the round.`);
    if (nextRound.status.tag !== "Open") {
      throw new Error(
        `This round is no longer accepting offers (current status: ${nextRound.status.tag}). Create a fresh live round and submit before the deadline.`,
      );
    }
    if (Number(nextRound.commit_deadline) * 1000 <= nowMs()) {
      throw new Error("Commit window closed. Create a fresh round and submit before the timer reaches zero.");
    }
    return nextRound;
  }

  async function sendCommitWithRoundRetry(
    target: string,
    args: Parameters<NonNullable<typeof contract>["commit_v2"]>[0],
  ) {
    let lastError: unknown;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      try {
        return await signAndSendWithSequenceRetry(() => contract!.commit_v2(args));
      } catch (error) {
        lastError = error;
        if (!isRoundReadPendingError(error) || attempt === 5) throw error;
        setRound(null);
        setLoadedRoundId(null);
        setLiveLoadError(`Round #${target} is still syncing before commit. Retrying...`);
        await refreshLiveWithRetry(target, { attempts: 2, delayMs: 900 }).catch(() => null);
        await wait(1100);
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error(displayError(lastError));
  }

  function liveProposalFromSubmission(submission: PilotSubmissionView): ProposalRecord {
    const details: ProposalDetails = {
      totalAmount: submission.totalAmount ?? Number(submission.amount ?? "0") / 10_000_000,
      timelineDays: submission.timelineDays ?? 1,
      approach: submission.approach ?? "",
      team: submission.metadata?.team ?? "Stellar wallet",
      deliverables: submission.deliverables ?? [],
      milestones: (submission.milestones ?? []).map((milestone) => ({
        title: milestone.title,
        description: milestone.description ?? milestone.title,
        amount: milestone.amount,
        receiver: milestone.receiver ?? submission.bidder,
        delivery: milestone.delivery ?? "",
      })),
    };
    return {
      id: `live-${submission.bidder}`,
      provider: submission.metadata?.provider ?? shortAddr(submission.bidder),
      providerMeta: submission.metadata?.providerMeta ?? "Stellar wallet",
      wallet: submission.bidder,
      submittedAt: nowMs(),
      revealed: true,
      source: "live",
      data: details,
    };
  }

  async function createLiveRound() {
    if (!contract || !address) {
      toast.push("error", "Wallet required", "Connect Freighter before creating a live round.");
      return;
    }
    if (!(await ensureFreshRoundInput())) return;
    setBusy("create-round");
    try {
      if (!CONTRACT_ID) throw new Error("No Core v2 contract is configured for this network");
      if (!project.title.trim()) throw new Error("Enter a project title");
      const drand = quicknet();
      const commitSeconds = deadlineSeconds(project.deadlinePreset);
      const revealRound = await roundInSeconds(drand, commitSeconds + 15);
      const info = await drand.chain().info();
      const revealAt = drandRoundTime(revealRound, info);
      const auditor = generateAuditorKeypair();
      const itemRef = await sha256Bytes(`${project.title}:${address}:${nowMs()}`);
      const sent = await signAndSendWithSequenceRetry(() => contract.create_round_v2({
        operator: address,
        item_ref: Buffer.from(itemRef),
        schema_ref: Buffer.from(SEALED_PROPOSAL_SCHEMA_REF),
        settlement: {
          mode: { tag: "ReceiptOnly", values: undefined },
          payment_asset: undefined,
          lot_asset: undefined,
          lot_amount: 0n,
        },
        reveal_round: BigInt(revealRound),
        clearing_rule: { tag: "LowestBid", values: undefined },
        commit_deadline: BigInt(revealAt - 10),
        reveal_deadline: BigInt(revealAt + 300),
        auditor_pubkey: Buffer.from(auditor.publicKey),
        max_participants: 25,
      }));
      const nextId = sent.result.unwrap().toString();
      const hash = txHashFromResult(sent);
      if (hash) rememberTransaction(hash);
      setMode("live");
      setRoundId(nextId);
      setRound(null);
      setLoadedRoundId(null);
      setLiveProposals([]);
      setSelectedProposalId(null);
      const followingId = (BigInt(nextId) + 1n).toString();
      setNextLiveRoundId(followingId);
      setRoundInput(followingId);
      setRoundInputWarning("");
      setDeadlineAt((revealAt - 10) * 1000);
      setLiveLoadError(`Round #${nextId} was created. Waiting for Stellar RPC to catch up...`);
      window.location.hash = `#/pilot/trustless-work/${nextId}`;
      toast.push("success", "Live round created", `ReceiptOnly round #${nextId}. Loading it now.`);
    } catch (error) {
      toast.push("error", "Round creation failed", displayError(error));
    } finally {
      setBusy(null);
    }
  }

  function resetWorkspace() {
    const nextProject = defaultProject();
    const nextProposalDraft = defaultProposalDraft();
    const nextProposals = seedSampleProposals();
    const nextSelected = nextProposals[0]?.id ?? null;
    const nextSelectedProposal = nextProposals.find((entry) => entry.id === nextSelected);
    setProject(nextProject);
    setMode("sample");
    setRole("organizer");
    setDeadlineAt(nowMs() + deadlineSeconds(nextProject.deadlinePreset) * 1000);
    setRoundId(null);
    setRoundInput("");
    setSelectedProposalId(nextSelected);
    setProposals(nextProposals);
    setProposalDraft(nextProposalDraft);
    setTrustlessWorkDraft(defaultTrustlessWorkDraft(nextSelectedProposal?.wallet));
    setTrustlessWorkReceipt(emptyReceipt());
    setTransactionHashes([]);
    setRound(null);
    setLoadedRoundId(null);
    setLiveProposals([]);
    setLiveLoadError("");
    window.location.hash = "#/pilot/trustless-work";
  }

  function startLowValuePilot() {
    resetWorkspace();
    setMode("live");
  }

  function updateProject<K extends keyof ProjectDraft>(key: K, value: ProjectDraft[K]) {
    setProject((current) => ({ ...current, [key]: value }));
  }

  function updateProposal<K extends keyof ProposalDraft>(key: K, value: ProposalDraft[K]) {
    setProposalDraft((current) => ({ ...current, [key]: value }));
  }

  function updateMilestone(index: number, key: keyof ProposalMilestoneDraft, value: string) {
    setProposalDraft((current) => {
      const milestones = current.milestones.slice();
      milestones[index] = { ...milestones[index], [key]: value };
      return { ...current, milestones };
    });
  }

  function addMilestone() {
    setProposalDraft((current) => ({
      ...current,
      milestones: [
        ...current.milestones,
        {
          title: "",
          description: "",
          amount: "",
          receiver: sampleWallet(60 + current.milestones.length),
          delivery: "",
        },
      ],
    }));
  }

  function removeMilestone(index: number) {
    setProposalDraft((current) => ({
      ...current,
      milestones: current.milestones.filter((_, itemIndex) => itemIndex !== index),
    }));
  }

  function updateTrustlessWorkDraft<K extends keyof TrustlessWorkDraft>(
    key: K,
    value: TrustlessWorkDraft[K],
  ) {
    setTrustlessWorkDraft((current) => ({ ...current, [key]: value }));
  }

  function createSampleProposal() {
    try {
      const details = buildProposalDetails(proposalDraft);
      const newRecord: ProposalRecord = {
        id: `demo-${nowMs().toString(36)}`,
        provider: proposalDraft.providerName.trim(),
        providerMeta: proposalDraft.providerMeta.trim() || "Invited provider",
        wallet: proposalDraft.providerWallet.trim(),
        submittedAt: nowMs(),
        revealed: false,
        source: "demo",
        data: details,
      };
      setProposals((current) => [...current, newRecord]);
      setSelectedProposalId(newRecord.id);
      setTrustlessWorkDraft((current) => ({ ...current, serviceProvider: newRecord.wallet }));
      setRole("provider");
      toast.push("success", "Private proposal stored", "Sample sealed proposal added to the workspace.");
    } catch (error) {
      toast.push("error", "Proposal validation failed", displayError(error));
    }
  }

  async function submitLiveProposal() {
    if (!contract || !address || !liveRoundId) {
      toast.push("error", "Live round required", "Connect a wallet and load or create a live round first.");
      return;
    }
    setBusy("submit-proposal");
    try {
      const currentRound = await requireLoadedOpenRound(liveRoundId);
      const details = buildProposalDetails(proposalDraft);
      const drand = quicknet();
      const sealed = await sealProposal({
        round: Number(currentRound.reveal_round),
        drand,
        identity: new TextEncoder().encode(address),
        auditorPublicKey: new Uint8Array(currentRound.auditor_pubkey),
        price: BigInt(Math.round(details.totalAmount * 10_000_000)),
        proposal: {
          timelineDays: details.timelineDays,
          approach: details.approach,
          totalAmount: details.totalAmount,
          currency: "USDC",
          deliverables: details.deliverables,
          milestones: details.milestones.map((milestone) => ({
            title: milestone.title,
            description: milestone.description,
            amount: milestone.amount,
            receiver: milestone.receiver,
            delivery: milestone.delivery,
          })),
          metadata: {
            provider: proposalDraft.providerName.trim(),
            providerMeta: proposalDraft.providerMeta.trim(),
            providerWallet: proposalDraft.providerWallet.trim(),
            team: details.team,
          },
        },
      });
      const sent = await sendCommitWithRoundRetry(liveRoundId, {
        round_id: BigInt(liveRoundId),
        bidder: address,
        commitment: Buffer.from(sealed.commitment),
        ciphertext: Buffer.from(sealed.ciphertext),
        escrow: 0n,
        auditor_blob: Buffer.from(sealed.auditorBlob),
      });
      const hash = txHashFromResult(sent);
      if (hash) rememberTransaction(hash);
      setRound((current) => (
        current
          ? { ...current, bidders: Array.from(new Set([...current.bidders, address])) }
          : current
      ));
      setProposals((current) => [
        ...current.filter((entry) => entry.source !== "live" || entry.wallet !== address),
        {
          id: `live-${address}`,
          provider: proposalDraft.providerName.trim(),
          providerMeta: proposalDraft.providerMeta.trim(),
          wallet: address,
          submittedAt: nowMs(),
          revealed: false,
          source: "live",
          data: details,
        },
      ]);
      setRole("organizer");
      await refreshLiveWithRetry(liveRoundId).catch(() => null);
      toast.push("success", "Private proposal submitted", `Sealed on ReceiptOnly round #${liveRoundId}`);
    } catch (error) {
      toast.push("error", "Proposal submission failed", displayError(error));
    } finally {
      setBusy(null);
    }
  }

  function revealSampleProposals() {
    if (!deadlinePassed || revealed || selectedProposal?.source === "live") return;
    setProposals((current) => current.map((entry) => ({ ...entry, revealed: true })));
    setRole("organizer");
    scrollToSelectionPanel();
    toast.push("success", "Sample proposals revealed", "All sample submissions are now visible.");
  }

  async function sendRevealWithRecovery<T>(
    buildTransaction: () => Promise<SignableTransaction<T>>,
  ): Promise<T> {
    try {
      return await signAndSendWithSequenceRetry(buildTransaction);
    } catch (error) {
      if (!isRetryableNetworkSendError(error)) throw error;
      const hash = txHashFromError(error);
      if (!hash) throw error;
      const transactionStatus = await waitForTestnetTransactionStatus(hash, { attempts: 7, delayMs: 1200 });
      rememberTransaction(hash);
      if (transactionStatus === "success") {
        toast.push("info", "Reveal transaction confirmed", "The network returned a temporary response, but the reveal transaction succeeded. Continuing without resubmitting.");
        return undefined as T;
      }
      if (transactionStatus === "pending") {
        throw new Error(`Reveal transaction ${shortHash(hash)} is still pending on Testnet. Wait a few seconds before trying again.`);
      }
      throw new Error(`Reveal transaction ${shortHash(hash)} failed on Testnet. You can try reveal again.`);
    }
  }

  async function waitForRevealGate(target: string): Promise<RoundV2> {
    if (!contract) throw new Error("Wallet required");
    let lastRound: RoundV2 | null = null;
    for (let attempt = 0; attempt < REVEAL_GATE_SYNC_ATTEMPTS; attempt += 1) {
      const next = (await contract.get_round_v2({ round_id: BigInt(target) })).result.unwrap();
      lastRound = next;
      if (next.status.tag === "Revealing" || next.status.tag === "Cleared" || next.status.tag === "Settled") {
        return next;
      }
      if (next.status.tag === "Voided") {
        throw new Error(`Round #${target} was voided.`);
      }
      await wait(REVEAL_GATE_SYNC_DELAY_MS);
    }
    if (lastRound) return lastRound;
    throw new Error(`Round #${target} is still syncing.`);
  }

  async function revealLiveProposals() {
    if (!contract || !round || !liveRoundId) return;
    if (round.status.tag === "Open" && !revealCountdown.published) {
      toast.push(
        "info",
        "Reveal not ready",
        `Drand round ${revealCountdown.targetRound} is not published yet. Try again in ${formatCountdown(revealCountdown.secondsRemaining)}.`,
      );
      return;
    }
    setBusy("reveal");
    try {
      const rid = BigInt(liveRoundId);
      const drand = quicknet();
      let current = (await contract.get_round_v2({ round_id: rid })).result.unwrap();
      if (current.status.tag === "Open") {
        const signature = await fetchRoundSignature(drand, Number(current.reveal_round));
        try {
          const sent = await sendRevealWithRecovery(() => (
            contract.open_reveal_v2({ round_id: rid, drand_signature: Buffer.from(signature) })
          ));
          rememberTransaction(txHashFromResult(sent));
        } catch (error) {
          if (!isRevealAlreadyOpen(error)) throw error;
        }
        current = await waitForRevealGate(liveRoundId);
      }
      if (current.status.tag === "Open") {
        current = await waitForRevealGate(liveRoundId);
      }
      if (current.status.tag !== "Revealing" && current.status.tag !== "Cleared" && current.status.tag !== "Settled") {
        throw new Error(`Reveal gate is still opening. Try again in ${formatCountdown(REVEAL_GATE_SYNC_ATTEMPTS * REVEAL_GATE_SYNC_DELAY_MS / 1000)}.`);
      }
      const bidders = (await contract.get_bidders_v2({ round_id: rid })).result.unwrap();
      let revealedCount = 0;
      let alreadyRevealedCount = 0;
      for (const bidder of bidders) {
        const state = (await contract.get_submission_v2({ round_id: rid, bidder })).result.unwrap();
        if (state.revealed_envelope != null) {
          alreadyRevealedCount += 1;
          continue;
        }
        const seal = (await contract.get_seal_v2({ round_id: rid, bidder })).result;
        if (!seal) throw new Error(`Encrypted offer is unavailable for ${shortAddr(bidder)}`);
        const envelope = await openPayload(new Uint8Array(seal.ciphertext), drand);
        try {
          const sent = await sendRevealWithRecovery(() => contract.reveal_v2({
            round_id: rid,
            bidder,
            envelope: Buffer.from(encodePayloadEnvelope(envelope)),
          }));
          rememberTransaction(txHashFromResult(sent));
          revealedCount += 1;
        } catch (error) {
          if (!isSubmissionAlreadyRevealed(error)) throw error;
          alreadyRevealedCount += 1;
        }
      }
      void refreshLiveWithRetry(liveRoundId, { attempts: 10, delayMs: 1200, waitForReveals: true }).catch((error) => {
        setLiveLoadError(displayError(error));
      });
      toast.push(
        "success",
        "Proposals revealed",
        `${revealedCount} new, ${alreadyRevealedCount} already open, ${bidders.length} participant(s) total`,
      );
      setRole("organizer");
      scrollToSelectionPanel();
    } catch (error) {
      if (isRevealGateNotReadyError(error)) {
        toast.push(
          "info",
          "Reveal not ready",
          `The reveal gate is still opening. Wait ${formatCountdown(Math.ceil((REVEAL_GATE_SYNC_ATTEMPTS * REVEAL_GATE_SYNC_DELAY_MS) / 1000))}, then try again.`,
        );
      } else {
        toast.push("error", "Reveal failed", displayError(error));
      }
    } finally {
      setBusy(null);
    }
  }

  function selectProposal(id: string) {
    setSelectedProposalId(id);
    const next = (mode === "live" ? liveProposals : proposals).find((entry) => entry.id === id);
    if (next) {
      setTrustlessWorkDraft((current) => ({ ...current, serviceProvider: next.wallet }));
    }
  }

  async function createTrustlessWorkEscrow() {
    if (!twConfig) {
      toast.push("error", "Trustless Work config missing", "Set VITE_TRUSTLESS_WORK_API_KEY before creating an escrow.");
      return;
    }
    if (!address) {
      toast.push("error", "Wallet required", "Connect Freighter before creating a Trustless Work escrow.");
      return;
    }
    if (!selectedProposal) {
      toast.push("error", "Select a proposal first", "Choose the winning proposal before creating the escrow.");
      return;
    }
    setBusy("deploy-escrow");
    try {
      const engagementId = roundId ? `sub-rosa-round-${roundId}` : `sub-rosa-sample-${project.title.toLowerCase().replace(/\s+/g, "-")}`;
      const payload = buildTrustlessWorkPayload(project, selectedProposal, trustlessWorkDraft, twConfig.apiVersion, address, engagementId);
      const build = await buildMultiReleaseEscrow(twConfig, payload);
      const contractIdFromBuild = readContractId(build.contractId);
      const signed = await signTransaction(build.unsignedXdr, {
        networkPassphrase: NETWORK,
        address,
      });
      const signedError = freighterError(signed);
      if (signedError) throw new Error(signedError);
      const submit = await sendTrustlessWorkTransaction(twConfig, signed.signedTxXdr);
      const deploymentTxHash = submit.txHash ?? build.txHash ?? null;
      let escrowContractId = submit.contractId
        ?? readContractId(submit.escrow)
        ?? contractIdFromBuild
        ?? readContractId(build.escrow)
        ?? null;
      if (!escrowContractId && deploymentTxHash) {
        try {
          escrowContractId = await resolveContractIdFromStellarTransaction(deploymentTxHash, RPC_URL, {
            attempts: 8,
            delayMs: 1200,
          });
        } catch {
          // The signer/indexer fallback below remains available when RPC metadata is delayed.
        }
      }
      setTrustlessWorkReceipt((current) => ({
        ...current,
        deployBuild: build,
        deploySubmit: submit,
        escrowContractId,
        escrow: submit.escrow ?? build.escrow ?? current?.escrow ?? null,
        refreshedAt: nowMs(),
      }));
      rememberTransaction(build.txHash);
      rememberTransaction(submit.txHash);
      if (submit.code === "STELLAR_TX_SUBMITTED_INDEXER_LAGGING" || !escrowContractId) {
        toast.push("info", "Trustless Work escrow submitted", escrowContractId
          ? `Contract ID ${shortHash(escrowContractId)} recovered from the Testnet transaction. The indexer is still catching up.`
          : "The tx landed, but the indexer has not caught up yet. The app will keep looking for the escrow.");
        void syncTrustlessWorkEscrow(escrowContractId, address, engagementId);
      } else {
        toast.push("success", "Trustless Work escrow created", submit.contractId ? shortHash(submit.contractId) : "Escrow submitted");
      }
    } catch (error) {
      toast.push("error", "Escrow creation failed", formatTrustlessWorkApiError(error, twConfig));
    } finally {
      setBusy(null);
    }
  }

  async function fundTrustlessWorkEscrow() {
    if (!twConfig) {
      toast.push("error", "Trustless Work config missing", "Set VITE_TRUSTLESS_WORK_API_KEY before funding an escrow.");
      return;
    }
    if (!address) {
      toast.push("error", "Wallet required", "Connect Freighter before funding the escrow.");
      return;
    }
    if (!selectedProposal) {
      toast.push("error", "Select a proposal first", "Choose the winning proposal before funding.");
      return;
    }
    setBusy("fund-escrow");
    try {
      const engagementId = roundId
        ? `sub-rosa-round-${roundId}`
        : `sub-rosa-sample-${project.title.toLowerCase().replace(/\s+/g, "-")}`;
      let contractId = trustlessWorkReceipt.escrowContractId ?? null;
      if (contractId) {
        try {
          const current = await getEscrowByContractId(twConfig, contractId);
          if (!readContractId(current.escrow) && !current.escrow.milestones?.length) {
            contractId = null;
          }
        } catch (error) {
          if (!/MissingValue|get_escrow|non-existing value/i.test(displayError(error))) throw error;
          contractId = null;
        }
      }
      if (!contractId) {
        const candidates = await getEscrowsBySigner(twConfig, address);
        const exactMatch = candidates.find((entry) => {
          const record = entry as Record<string, unknown>;
          return entry.engagementId === engagementId || record.engagement_id === engagementId;
        });
        const titleMatches = candidates.filter((entry) => entry.title === project.title);
        const escrow = exactMatch ?? (titleMatches.length === 1 ? titleMatches[0] : candidates.length === 1 ? candidates[0] : undefined);
        contractId = readContractId(escrow);
      }
      if (!contractId) {
        throw new Error("The escrow is still being indexed. Wait a few seconds, refresh the escrow, then fund it.");
      }
      const build = await fundMultiReleaseEscrow(twConfig, {
        contractId,
        signer: address,
        amount: selectedProposal.data.totalAmount,
      });
      const signed = await signTransaction(build.unsignedXdr, {
        networkPassphrase: NETWORK,
        address,
      });
      const signedError = freighterError(signed);
      if (signedError) throw new Error(signedError);
      const submit = await sendTrustlessWorkTransaction(twConfig, signed.signedTxXdr);
      setTrustlessWorkReceipt((current) => ({
        ...current,
        fundBuild: build,
        fundSubmit: submit,
        escrowContractId: submit.contractId ?? current.escrowContractId ?? contractId,
        escrow: submit.escrow ?? build.escrow ?? current.escrow ?? null,
        refreshedAt: nowMs(),
      }));
      rememberTransaction(build.txHash);
      rememberTransaction(submit.txHash);
      toast.push("success", "Escrow funding submitted", submit.message || "Funding tx submitted to Stellar");
    } catch (error) {
      toast.push("error", "Escrow funding failed", formatTrustlessWorkApiError(error, twConfig));
    } finally {
      setBusy(null);
    }
  }

  async function refreshTrustlessWorkEscrow() {
    if (!twConfig || !address) return;
    const engagementId = roundId
      ? `sub-rosa-round-${roundId}`
      : `sub-rosa-sample-${project.title.toLowerCase().replace(/\s+/g, "-")}`;
    let contractId = trustlessWorkReceipt.escrowContractId ?? null;
    const deploymentTxHash = trustlessWorkReceipt.deploySubmit?.txHash;
    if (!contractId && deploymentTxHash) {
      try {
        contractId = await resolveContractIdFromStellarTransaction(deploymentTxHash, RPC_URL, {
          attempts: 5,
          delayMs: 1200,
        });
        if (contractId) {
          setTrustlessWorkReceipt((current) => ({ ...current, escrowContractId: contractId }));
        }
      } catch {
        // The signer lookup below can still recover the escrow when RPC metadata is unavailable.
      }
    }
    await syncTrustlessWorkEscrow(contractId, address, engagementId);
  }

  async function syncTrustlessWorkEscrow(contractId: string | null, signer: string, engagementId: string) {
    if (!twConfig) return;
    setBusy("refresh-escrow");
    try {
      let lastError: unknown = null;
      for (let attempt = 0; attempt < 8; attempt += 1) {
        try {
          let candidates: TrustlessWorkEscrowSnapshot[] = [];
          if (contractId) {
            try {
              const direct = (await getEscrowByContractId(twConfig, contractId)).escrow;
              if (direct && (readContractId(direct) || direct.milestones?.length)) {
                candidates = [direct];
              }
            } catch (error) {
              lastError = error;
            }
          }
          if (!candidates.length) {
            candidates = await getEscrowsBySigner(twConfig, signer);
          }
          const exactMatch = candidates.find((entry) => entry.engagementId === engagementId);
          const titleMatches = candidates.filter((entry) => entry.title === project.title);
          const escrow = exactMatch ?? (titleMatches.length === 1 ? titleMatches[0] : candidates.length === 1 ? candidates[0] : undefined);
          const resolvedContractId = readContractId(escrow);
          const hasEscrowData = Boolean(escrow && (resolvedContractId || escrow.milestones?.length));
          if (hasEscrowData && escrow) {
            setTrustlessWorkReceipt((current) => ({
              ...current,
              escrow,
              escrowContractId: resolvedContractId ?? current.escrowContractId,
              refreshedAt: nowMs(),
            }));
            toast.push("success", "Escrow is ready", "The Trustless Work indexer has caught up. You can fund the escrow now.");
            return;
          }
        } catch (error) {
          lastError = error;
        }
        if (attempt < 7) {
          await new Promise((resolve) => window.setTimeout(resolve, 1500));
        }
      }
      if (lastError) throw lastError;
      toast.push("info", "Escrow is still syncing", "Wait a few seconds, then use Refresh escrow again.");
    } catch (error) {
      toast.push("error", "Escrow refresh failed", formatTrustlessWorkApiError(error, twConfig));
    } finally {
      setBusy(null);
    }
  }

  async function downloadReceipt() {
    if (!sdk || !roundId || !round) return;
    setBusy("receipt");
    try {
      const receipt = await sdk.exportReceiptV2(BigInt(roundId));
      const verification = verifyReceiptV2(receipt);
      if (!verification.valid) throw new Error("Receipt verification failed");
      const blob = new Blob([serializeReceiptV2(receipt)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `sub-rosa-trustless-work-round-${roundId}-receipt.json`;
      link.click();
      URL.revokeObjectURL(url);
      toast.push("success", "Receipt verified", `Round #${roundId} downloaded`);
    } catch (error) {
      toast.push("error", "Receipt export failed", displayError(error));
    } finally {
      setBusy(null);
    }
  }

  async function copyLink() {
    const suffix = mode === "live" && liveRoundId ? `/${liveRoundId}` : "";
    const url = `${window.location.origin}${window.location.pathname}#/pilot/trustless-work${suffix}`;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  function updateTrustlessWorkRole(field: keyof TrustlessWorkDraft, value: string) {
    updateTrustlessWorkDraft(field, value);
  }

  function selectedProposalPreview(): Array<[string, string]> {
    if (!selectedProposal) return [];
    return [
      ["Provider", selectedProposal.provider],
      ["Total", `${selectedProposal.data.totalAmount.toLocaleString()} USDC`],
      ["Timeline", `${selectedProposal.data.timelineDays} days`],
      ["Team", selectedProposal.data.team],
      ["Receivers", selectedProposal.data.milestones.map((milestone) => shortAddr(milestone.receiver)).join(" | ")],
    ];
  }

  const bridgeSteps = [
    { label: "Create project", done: true },
    { label: "Private proposals", done: participantCount > 0 },
    { label: "Deadline", done: deadlinePassed },
    { label: "Reveal", done: revealed },
    { label: "Select winner", done: Boolean(selectedProposal) },
    { label: "Create escrow", done: Boolean(trustlessWorkReceipt.deploySubmit?.txHash || trustlessWorkReceipt.deploySubmit?.status || trustlessWorkReceipt.escrowContractId) },
    { label: "Fund escrow", done: Boolean(trustlessWorkReceipt.fundSubmit?.txHash || trustlessWorkReceipt.fundSubmit?.status) },
  ];
  const escrowSubmissionStarted = Boolean(
    trustlessWorkReceipt.deploySubmit?.txHash ||
    trustlessWorkReceipt.escrowContractId,
  );

  function proposalList(): ProposalRecord[] {
    return mode === "live" ? liveProposals : proposals;
  }

  function liveBidderProposal(bidder: string): ProposalRecord | undefined {
    return liveProposals.find((proposal) => proposal.wallet === bidder);
  }

  return (
    <main className="pilot-page trustless-work-pilot-page">
      <ConfettiBurst fire={confettiTick} count={48} />
      <nav className="pilot-nav">
        <button type="button" className="brand-link" onClick={goHome}>
          <img src={LOGO_SRC} alt="" />
          <span>Sub Rosa</span>
        </button>
        <div className="pilot-nav-actions">
          <span className="pilot-network">{twConfig ? "Trustless Work testnet pilot" : "Testnet integration pilot"}</span>
          <div className="pilot-template-switch" role="tablist" aria-label="Pilot mode">
            <button type="button" className={mode === "sample" ? "active" : ""} onClick={() => setMode("sample")}>Sample</button>
            <button type="button" className={mode === "live" ? "active" : ""} onClick={() => setMode("live")}>Live</button>
          </div>
          <a href="#/docs" className="secondary-action compact">Docs</a>
          <button type="button" className="secondary-action compact" onClick={copyLink}>
            {copied ? "Copied" : "Copy link"}
          </button>
          <button type="button" className="secondary-action compact" onClick={connect} disabled={busy !== null}>
            {address ? shortAddr(address) : busy === "connect" ? "Connecting..." : "Connect wallet"}
          </button>
        </div>
      </nav>

      <header className="pilot-header">
        <div>
          <span className="pilot-kicker"><ShieldCheck size={15} /> Testnet integration pilot</span>
          <h1>Sub Rosa x Trustless Work</h1>
          <p className="lede">Private proposals stay sealed through the deadline, then the chosen proposal is converted into a real Trustless Work multi-release escrow on testnet.</p>
        </div>
        <div className="pilot-partner-identity trustless-work-partner-identity">
          <img className="pilot-partner-mark" src="/pilots/trustless-work/trustless-work-logo.webp" alt="Trustless Work" />
          <div className="pilot-template-switch" aria-label="Role">
            <button type="button" className={role === "organizer" ? "active" : ""} onClick={() => setRole("organizer")}>Organizer</button>
            <button type="button" className={role === "provider" ? "active" : ""} onClick={() => setRole("provider")}>Provider</button>
          </div>
        </div>
      </header>

      {(twConfigIssues.length > 0 || !CONTRACT_ID) && (
        <div className="pilot-alert">
          {twConfigIssues.length > 0 && <div>{twConfigIssues.join(" ")}</div>}
          {!CONTRACT_ID && <div>Sub Rosa VITE_CONTRACT_ID is not configured.</div>}
        </div>
      )}

      <section className="signal-pilot-flow" aria-label="Pilot flow">
        {bridgeSteps.map((step, index) => (
          <div className={step.done ? "done" : ""} key={step.label}>
            <span>{step.done ? <CheckCircle2 size={15} /> : index + 1}</span>
            <strong>{step.label}</strong>
            {index < bridgeSteps.length - 1 && <ArrowRight size={15} aria-hidden="true" />}
          </div>
        ))}
      </section>

      <section className="pilot-layout">
        <div className="pilot-panel">
          <div className="pilot-panel-heading">
            <span>Project</span>
            <strong>RFP setup</strong>
          </div>
          <div className="pilot-form">
            <label>
              Project title
              <input value={project.title} onChange={(event) => updateProject("title", event.target.value)} />
            </label>
            <label>
              Project description
              <textarea rows={3} value={project.description} onChange={(event) => updateProject("description", event.target.value)} />
            </label>
            <div className="pilot-facts">
              <div><dt>Budget</dt><dd>{project.budget} USDC</dd></div>
              <div><dt>Deadline</dt><dd>{deadlineLabel(project.deadlinePreset)}</dd></div>
              <div><dt>Time left</dt><dd><Clock3 size={13} style={{ display: "inline", verticalAlign: "-2px", marginRight: 6 }} />{roundCountdown}</dd></div>
              <div><dt>Status</dt><dd>{sampleStatusLabel(status)}</dd></div>
              <div><dt>Round ID</dt><dd>{roundId ? `#${roundId}` : "Not created"}</dd></div>
            </div>
            <label>
              Proposal window
              <select value={project.deadlinePreset} onChange={(event) => updateProject("deadlinePreset", event.target.value as DeadlinePreset)}>
                {DEADLINE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            {mode === "live" && (
              <div className="signal-live-load">
                <label>
                  Next live round ID
                  <input
                    inputMode="numeric"
                    placeholder={nextLiveRoundId ? `#${nextLiveRoundId}` : "Checking next ID"}
                    value={roundInput}
                    onChange={(event) => updateRoundInput(event.target.value)}
                    onFocus={refreshSuggestedRoundInput}
                    aria-invalid={Boolean(currentRoundInputIssue || roundInputWarning)}
                  />
                </label>
                <button
                  type="button"
                  className="secondary-action compact"
                  onClick={refreshSuggestedRoundInput}
                  disabled={busy !== null || roundProbeBusy}
                >
                  <RefreshCw size={15} />
                  {roundProbeBusy ? "Checking..." : "Refresh next"}
                </button>
              </div>
            )}
            {mode === "live" && (currentRoundInputIssue || roundInputWarning) && (
              <p className="signal-helper trustless-work-round-warning">{currentRoundInputIssue || roundInputWarning}</p>
            )}
            <div className="pilot-actions">
              <button
                type="button"
                className="primary-action"
                onClick={createLiveRound}
                disabled={busy !== null || roundProbeBusy || Boolean(currentRoundInputIssue || roundInputWarning)}
              >
                {busy === "create-round" ? "Creating..." : <><FileCheck2 size={16} />Create live round</>}
              </button>
              <button type="button" className="secondary-action" onClick={resetWorkspace} disabled={busy !== null}>
                <RefreshCw size={16} />
                Reset workspace
              </button>
            </div>
            <p className="signal-helper">{mode === "live" ? `Creates a real Core v2 ReceiptOnly round with a ${deadlineLabel(project.deadlinePreset)} commit window.` : "Sample mode uses local sealed proposals. Switch to Live to create a real on-chain round."}</p>
          </div>
        </div>

        <div className="pilot-panel">
          <div className="pilot-panel-heading">
            <span>Organizer</span>
            <strong>{revealed ? "Compare proposals" : "Private submission count"}</strong>
          </div>
          <div className="signal-private-state">
            <LockKeyhole size={18} />
            <div>
              <strong>{revealed ? "Proposals are now visible" : "Proposals stay private until the deadline"}</strong>
              <p>{revealed ? "Sub Rosa verifies the sealed process. The organizer makes the business selection." : "Provider names may be visible, but pricing, timeline, approach, and milestone plan remain sealed."}</p>
            </div>
          </div>
          <div className="signal-provider-list">
            {mode === "live"
              ? (
                  activeRoundReady && round?.bidders.length
                    ? round.bidders.map((bidder) => {
                        const proposal = liveBidderProposal(bidder);
                        return (
                          <div key={bidder}>
                            <span className="signal-provider-dot" />
                            <div>
                              <strong>{proposal?.provider ?? shortWallet(bidder)}</strong>
                              <span>{proposal?.providerMeta ?? "Submission sealed on-chain"}</span>
                            </div>
                            <code>{proposal?.revealed ? "revealed" : "sealed"}</code>
                          </div>
                        );
                      })
                    : (
                        <div className="trustless-work-empty-row">
                          <span className="signal-provider-dot" />
                          <div>
                            <strong>No live submissions yet</strong>
                            <span>Provider commits will appear here as sealed participants.</span>
                          </div>
                          <code>0</code>
                        </div>
                      )
                )
              : proposalList().map((proposal) => (
                  <div key={proposal.id}>
                    <span className="signal-provider-dot" />
                    <div>
                      <strong>{shortWallet(proposal.wallet)}</strong>
                      <span>{proposal.providerMeta}</span>
                    </div>
                    <code>{proposal.revealed ? "revealed" : "sealed"}</code>
                  </div>
                ))}
          </div>
          <div className="pilot-actions">
            {mode === "sample" && !deadlinePassed && (
              <button type="button" className="secondary-action" onClick={() => setDeadlineAt(nowMs() - 1000)}>
                <LockKeyhole size={16} />
                Fast-forward deadline
              </button>
            )}
            {mode === "sample" && deadlinePassed && !revealed && (
              <button type="button" className="primary-action" onClick={revealSampleProposals}>
                <UnlockIcon />
                Reveal sample proposals
              </button>
            )}
            {mode === "live" && liveRoundId && !deadlinePassed && (
              <span className="signal-reveal-note"><LockKeyhole size={15} />Commit deadline is still open</span>
            )}
            {mode === "live" && liveRoundId && deadlinePassed && !revealed && (
              <button type="button" className="primary-action" onClick={revealLiveProposals} disabled={busy !== null || !revealActionReady}>
                <UnlockIcon />
                {revealButtonLabel}
              </button>
            )}
            {revealed && (
              <>
                <span className="signal-reveal-note"><CheckCircle2 size={15} />All offers opened together</span>
                {selectedProposal ? (
                  <button type="button" className="primary-action compact" onClick={scrollToHandoffPanel} disabled={busy !== null}>
                    <Sparkles size={15} />
                    Create escrow next
                  </button>
                ) : (
                  <button type="button" className="primary-action compact" onClick={scrollToSelectionPanel} disabled={busy !== null}>
                    <ArrowRight size={15} />
                    Select winner
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        <aside className="pilot-panel" ref={handoffPanelRef}>
          <div className="pilot-panel-heading">
            <span>{role === "organizer" ? "Handoff" : "Provider"}</span>
            <strong>{role === "organizer" ? "Trustless Work preview" : "Private proposal"}</strong>
          </div>

          {role === "provider" ? (
            <div className="pilot-form">
              <label>
                Provider name
                <input value={proposalDraft.providerName} onChange={(event) => updateProposal("providerName", event.target.value)} />
              </label>
              <label>
                Provider meta
                <input value={proposalDraft.providerMeta} onChange={(event) => updateProposal("providerMeta", event.target.value)} />
              </label>
              <label>
                Provider wallet
                <input value={proposalDraft.providerWallet} onChange={(event) => updateProposal("providerWallet", event.target.value)} />
              </label>
              <div className="signal-form-grid">
                <label>
                  Total amount
                  <input inputMode="numeric" value={proposalDraft.totalAmount} onChange={(event) => updateProposal("totalAmount", event.target.value)} />
                </label>
                <label>
                  Timeline (days)
                  <input inputMode="numeric" value={proposalDraft.timelineDays} onChange={(event) => updateProposal("timelineDays", event.target.value)} />
                </label>
              </div>
              <label>
                Approach
                <textarea rows={3} value={proposalDraft.approach} onChange={(event) => updateProposal("approach", event.target.value)} />
              </label>
              <label>
                Team
                <input value={proposalDraft.team} onChange={(event) => updateProposal("team", event.target.value)} />
              </label>
              <label>
                Deliverables
                <textarea rows={3} value={proposalDraft.deliverables} onChange={(event) => updateProposal("deliverables", event.target.value)} />
              </label>
              <div className="pilot-panel-heading" style={{ minHeight: 0, padding: "0 0 4px", borderBottom: 0 }}>
                <span>Milestones</span>
                <button type="button" className="secondary-action compact" onClick={addMilestone}><Upload size={14} />Add milestone</button>
              </div>
              <div className="trustless-work-pilot-milestones">
                {proposalDraft.milestones.map((milestone, index) => (
                  <div key={`${milestone.title}-${index}`} className="trustless-work-pilot-milestone">
                    <div className="signal-form-grid">
                      <label>
                        Title
                        <input value={milestone.title} onChange={(event) => updateMilestone(index, "title", event.target.value)} />
                      </label>
                      <label>
                        Amount
                        <input inputMode="numeric" value={milestone.amount} onChange={(event) => updateMilestone(index, "amount", event.target.value)} />
                      </label>
                    </div>
                    <label>
                      Description
                      <textarea rows={2} value={milestone.description} onChange={(event) => updateMilestone(index, "description", event.target.value)} />
                    </label>
                    <div className="signal-form-grid">
                      <label>
                        Receiver
                        <input value={milestone.receiver} onChange={(event) => updateMilestone(index, "receiver", event.target.value)} />
                      </label>
                      <label>
                        Delivery
                        <input value={milestone.delivery} onChange={(event) => updateMilestone(index, "delivery", event.target.value)} />
                      </label>
                    </div>
                    <button type="button" className="secondary-action compact" onClick={() => removeMilestone(index)} disabled={proposalDraft.milestones.length === 1}>
                      <X size={14} />
                      Remove
                    </button>
                  </div>
                ))}
              </div>
              {mode === "live" && (
                <div className="signal-provider-callout trustless-work-live-round-status">
                  <RefreshCw size={18} />
                  <div>
                    <strong>{activeLiveRoundId ? `Live round #${activeLiveRoundId}` : "No live round selected"}</strong>
                    <p>{liveProviderRoundMessage}</p>
                    {!activeRoundReady && activeLiveRoundId && (
                      <button type="button" className="secondary-action compact" onClick={reloadActiveRound} disabled={busy !== null}>
                        <RefreshCw size={14} />
                        {busy === "load-round" ? "Loading..." : "Reload round"}
                      </button>
                    )}
                  </div>
                </div>
              )}
              <button type="button" className="primary-action" onClick={mode === "live" ? submitLiveProposal : createSampleProposal} disabled={busy !== null || (mode === "live" && (!activeRoundReady || !liveRoundId || !liveSubmissionOpen))}>
                <LockKeyhole size={16} />
                {mode === "live"
                  ? busy === "submit-proposal"
                    ? "Waiting for wallet..."
                    : !activeRoundReady || !liveRoundId
                      ? "Load live round first"
                      : connectedWalletAlreadySubmitted
                        ? "Update sealed proposal on-chain"
                      : liveSubmissionOpen
                        ? "Submit private proposal on-chain"
                        : "Round closed"
                  : "Submit private proposal"}
              </button>
              <p className="signal-helper">{mode === "live" ? "Live proposals must be submitted before the commit deadline. Once the round is revealed or settled, it becomes read-only." : "The sealed proposal carries total amount, timeline, approach, deliverables, and milestone plan. Before reveal, those fields stay hidden."}</p>
            </div>
          ) : (
            <div className="pilot-form">
              <div className="pilot-facts">
                <div><dt>Selected provider</dt><dd>{selectedProposal ? selectedProposal.provider : "Not selected"}</dd></div>
                <div><dt>Proposal total</dt><dd>{selectedProposal ? `${selectedProposal.data.totalAmount.toLocaleString()} USDC` : "Not set"}</dd></div>
                <div><dt>Status</dt><dd>{sampleStatusLabel(status)}</dd></div>
                <div><dt>Trustless Work</dt><dd>{twConfig ? `${twConfig.baseUrl} · ${twApiVersion.toUpperCase()}` : "Config missing"}</dd></div>
              </div>
              {selectedProposal && (
                <>
                  <div className="signal-private-state">
                    <ShieldCheck size={18} />
                    <div>
                      <strong>{"Selected proposal -> Trustless Work preview"}</strong>
                      <p>The preview below shows the exact fields that will be sent to Trustless Work {twApiVersion.toUpperCase()} testnet.</p>
                    </div>
                  </div>
                  <div className="pilot-facts">
                    {selectedProposalPreview().map(([label, value]) => (
                      <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
                    ))}
                  </div>
                  <div className="signal-receipt-grid">
                    <dl>
                      <div><dt>Platform fee</dt><dd>{trustlessWorkDraft.platformFee}%</dd></div>
                      <div><dt>Approver</dt><dd>{shortWallet(trustlessWorkDraft.approver)}</dd></div>
                      <div><dt>Service provider</dt><dd>{shortWallet(trustlessWorkDraft.serviceProvider || selectedProposal.wallet)}</dd></div>
                      <div><dt>Platform</dt><dd>{shortWallet(trustlessWorkDraft.platform)}</dd></div>
                    </dl>
                    <dl>
                      <div><dt>Release signer</dt><dd>{shortWallet(trustlessWorkDraft.releaseSigner)}</dd></div>
                      <div><dt>Dispute resolver</dt><dd>{shortWallet(trustlessWorkDraft.disputeResolver)}</dd></div>
                      <div><dt>Admin</dt><dd>{shortWallet(trustlessWorkDraft.admin)}</dd></div>
                      <div><dt>Trustline</dt><dd>{trustlineSummary(resolveTrustlessWorkTrustline(trustlessWorkDraft, twApiVersion))}</dd></div>
                    </dl>
                  </div>
                  <div className="trustless-work-action-rail">
                    <div className="trustless-work-action-copy">
                      <span>Escrow actions</span>
                      <strong>Create, fund, refresh</strong>
                      <p>Create the escrow first. Fund it after the contract ID returns, then refresh to pull the latest on-chain state.</p>
                    </div>
                    <div className="pilot-actions">
                      <button type="button" className="primary-action" onClick={createTrustlessWorkEscrow} disabled={!selectedProposal || busy !== null || !twConfig || escrowSubmissionStarted}>
                        <Sparkles size={16} />
                        {escrowSubmissionStarted
                          ? trustlessWorkReceipt.escrowContractId ? "Escrow created" : "Escrow submitted - syncing"
                          : "Create Multi-Release Escrow"}
                      </button>
                      <button type="button" className="secondary-action" onClick={fundTrustlessWorkEscrow} disabled={!trustlessWorkReceipt.escrowContractId || busy !== null || !twConfig}>
                        <WalletCards size={16} />
                        Fund escrow
                      </button>
                      <button type="button" className="secondary-action" onClick={refreshTrustlessWorkEscrow} disabled={(!trustlessWorkReceipt.escrowContractId && !trustlessWorkReceipt.deploySubmit?.txHash) || busy !== null || !twConfig || !address}>
                        <RefreshCw size={16} />
                        Refresh escrow
                      </button>
                    </div>
                    <p className="signal-helper trustless-work-trustline-note">
                      Funding needs at least {selectedProposal.data.totalAmount.toLocaleString()} USDC plus a small XLM fee in the connected organizer wallet. A trustline only allows the wallet to hold USDC; it does not add a USDC balance. Testnet USDC is available from the <a href="https://faucet.circle.com" target="_blank" rel="noreferrer">Circle faucet <ExternalLink size={13} /></a> after selecting Stellar.
                    </p>
                    {selectedProposal.data.totalAmount > 20 && (
                      <div className="signal-live-load trustless-work-funding-warning">
                        <strong>This proposal belongs to an older high-value round.</strong>
                        <span>Its {selectedProposal.data.totalAmount.toLocaleString()} USDC total is sealed on-chain and cannot be changed. Start a fresh 10 USDC pilot for the faucet-sized Testnet flow.</span>
                        <button type="button" className="secondary-action compact" onClick={startLowValuePilot} disabled={busy !== null}>
                          <RefreshCw size={15} />
                          Start 10 USDC pilot
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="pilot-panel-heading trustless-work-advanced-heading">
                    <span>Milestones</span>
                    <strong>Proposed release plan</strong>
                  </div>
                  <div className="trustless-work-pilot-milestones">
                    {selectedProposal.data.milestones.map((milestone) => (
                      <div key={`${selectedProposal.id}-${milestone.title}`} className="trustless-work-pilot-milestone">
                        <div className="pilot-facts">
                          <div><dt>Milestone</dt><dd>{milestone.title}</dd></div>
                          <div><dt>Amount</dt><dd>{usdc(milestone.amount)} USDC</dd></div>
                          <div><dt>Receiver</dt><dd>{shortWallet(milestone.receiver)}</dd></div>
                          <div><dt>Delivery</dt><dd>{milestone.delivery}</dd></div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="pilot-panel-heading trustless-work-advanced-heading">
                    <span>Advanced</span>
                    <strong>Roles, trustline, memo</strong>
                  </div>
                  <div className="pilot-form" style={{ paddingInline: 0 }}>
                    <label>
                      Platform fee
                      <input inputMode="numeric" value={trustlessWorkDraft.platformFee} onChange={(event) => updateTrustlessWorkRole("platformFee", event.target.value)} />
                    </label>
                    <div className="signal-form-grid">
                      <label>
                        Approver
                        <input value={trustlessWorkDraft.approver} onChange={(event) => updateTrustlessWorkRole("approver", event.target.value)} />
                      </label>
                      <label>
                        Release signer
                        <input value={trustlessWorkDraft.releaseSigner} onChange={(event) => updateTrustlessWorkRole("releaseSigner", event.target.value)} />
                      </label>
                    </div>
                    <div className="signal-form-grid">
                      <label>
                        Platform
                        <input value={trustlessWorkDraft.platform} onChange={(event) => updateTrustlessWorkRole("platform", event.target.value)} />
                      </label>
                      <label>
                        Dispute resolver
                        <input value={trustlessWorkDraft.disputeResolver} onChange={(event) => updateTrustlessWorkRole("disputeResolver", event.target.value)} />
                      </label>
                    </div>
                    <div className="signal-form-grid">
                      <label>
                        Admin
                        <input value={trustlessWorkDraft.admin} onChange={(event) => updateTrustlessWorkRole("admin", event.target.value)} />
                      </label>
                      <label>
                        Service provider
                        <input value={trustlessWorkDraft.serviceProvider} onChange={(event) => updateTrustlessWorkRole("serviceProvider", event.target.value)} />
                      </label>
                    </div>
                    <label>
                      Observers (comma or space separated)
                      <textarea rows={2} value={trustlessWorkDraft.observers} onChange={(event) => updateTrustlessWorkRole("observers", event.target.value)} />
                    </label>
                    <div className="signal-form-grid">
                      {isTrustlessWorkV1 ? (
                        <label>
                          Trustline issuer address
                          <input placeholder="G... USDC issuer" value={trustlessWorkDraft.trustlineAddress} onChange={(event) => updateTrustlessWorkRole("trustlineAddress", event.target.value)} />
                        </label>
                      ) : (
                        <>
                          <label>
                            Trustline contract ID
                            <input placeholder="Canonical testnet USDC contract" value={trustlessWorkDraft.trustlineContractId} onChange={(event) => updateTrustlessWorkRole("trustlineContractId", event.target.value)} />
                          </label>
                          <label>
                            Trustline symbol
                            <input placeholder="USDC" value={trustlessWorkDraft.trustlineSymbol} onChange={(event) => updateTrustlessWorkRole("trustlineSymbol", event.target.value)} />
                          </label>
                        </>
                      )}
                    </div>
                    <div className="signal-form-grid">
                      {!isTrustlessWorkV1 && (
                        <label>
                          Trustline address
                          <input placeholder="G... issuer or C... asset address" value={trustlessWorkDraft.trustlineAddress} onChange={(event) => updateTrustlessWorkRole("trustlineAddress", event.target.value)} />
                        </label>
                      )}
                      <label>
                        Receiver memo
                        <input inputMode="numeric" value={trustlessWorkDraft.receiverMemo} onChange={(event) => updateTrustlessWorkRole("receiverMemo", event.target.value)} />
                      </label>
                    </div>
                    <p className="signal-helper trustless-work-trustline-note">
                      {isTrustlessWorkV1
                        ? "v1 Testnet uses the USDC symbol plus issuer address. The provider and every milestone receiver still need a real funded Testnet wallet with a USDC trustline."
                        : "The contract ID is prefilled with the canonical testnet USDC contract. Leave it alone unless you are testing a custom asset with a valid C... contract address."}
                    </p>
                  </div>
                </>
              )}
              {!selectedProposal && <div className="pilot-empty">Select a revealed proposal to build the Trustless Work escrow preview.</div>}
              {!twConfig && <div className="pilot-empty">Add a Trustless Work API key to create a real testnet escrow.</div>}
            </div>
          )}
        </aside>

        {revealed && (
          <section className="pilot-results-panel" ref={selectionPanelRef}>
            <div className="pilot-panel-heading">
              <span>Selection</span>
              <strong>{selectedProposal ? "Winner selected" : "Select winner"}</strong>
            </div>
            <div className="signal-offer-grid">
              {liveProposalDataPending ? (
                <div className="pilot-empty trustless-work-reveal-sync" role="status">
                  <RefreshCw size={18} />
                  <strong>Revealed proposals are syncing...</strong>
                  <span>The proposals are open on-chain. This page will show the selection cards automatically in a few seconds.</span>
                </div>
              ) : proposalList().filter((entry) => entry.revealed).map((entry) => (
                <article className={`signal-offer ${selectedProposalId === entry.id ? "selected" : ""}`} key={entry.id}>
                  <div className="signal-offer-heading">
                    <div>
                      <span>{proposalSourceLabel(entry.source)} proposal</span>
                      <h3>{entry.provider}</h3>
                    </div>
                    {selectedProposalId === entry.id && <span className="signal-selected-badge"><CheckCircle2 size={14} />Selected</span>}
                  </div>
                  <dl>
                    {proposalRows(entry).map(([label, value]) => (
                      <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
                    ))}
                  </dl>
                  <div className="signal-private-state">
                    <LockKeyhole size={18} />
                    <div>
                      <strong>Milestone plan</strong>
                      <p>{entry.data.milestones.map((milestone) => `${milestone.title} ${usdc(milestone.amount)} USDC`).join(" | ")}</p>
                    </div>
                  </div>
                  <button type="button" className={selectedProposalId === entry.id ? "secondary-action compact" : "primary-action compact"} onClick={() => selectProposal(entry.id)}>
                    {selectedProposalId === entry.id ? "Winner selected" : "Select winner"}
                    <ArrowRight size={15} />
                  </button>
                </article>
              ))}
            </div>
            <p className="signal-selection-note"><ShieldCheck size={15} />Sub Rosa verifies the sealed proposal process. The organizer makes the business selection.</p>
          </section>
        )}

        <section className="pilot-results-panel">
          <div className="pilot-panel-heading">
            <span>Receipt</span>
            <strong>Combined pilot evidence</strong>
          </div>
          <div className="signal-receipt-grid">
            <dl>
              <div><dt>Sub Rosa network</dt><dd>{STELLAR_NETWORK === "mainnet" ? NETWORK_LABEL : `${NETWORK_LABEL} · testnet`}</dd></div>
              <div><dt>Round ID</dt><dd>{roundId ? `#${roundId}` : "Sample only"}</dd></div>
              <div><dt>Mode</dt><dd>ReceiptOnly</dd></div>
              <div><dt>Participants</dt><dd>{participantCount}</dd></div>
              <div><dt>Reveal state</dt><dd>{revealed ? "Revealed" : "Sealed"}</dd></div>
              <div><dt>Selected proposal</dt><dd>{selectedProposal ? selectedProposal.provider : "Not selected"}</dd></div>
            </dl>
            <dl>
              <div><dt>Trustless Work network</dt><dd>{twConfig ? `${twConfig.baseUrl} · ${twApiVersion.toUpperCase()}` : "Not configured"}</dd></div>
              <div><dt>Escrow ID</dt><dd>{trustlessWorkReceipt.escrowContractId ? shortHash(trustlessWorkReceipt.escrowContractId) : "Not created"}</dd></div>
              <div><dt>Total amount</dt><dd>{selectedProposal ? `${selectedProposal.data.totalAmount.toLocaleString()} USDC` : "Not selected"}</dd></div>
              <div><dt>Creation tx</dt><dd>{trustlessWorkReceipt.deploySubmit?.txHash ? shortHash(trustlessWorkReceipt.deploySubmit.txHash) : trustlessWorkReceipt.deploySubmit?.status ? trustlessWorkReceipt.deploySubmit.status : "Not submitted"}</dd></div>
              <div><dt>Funding tx</dt><dd>{trustlessWorkReceipt.fundSubmit?.txHash ? shortHash(trustlessWorkReceipt.fundSubmit.txHash) : trustlessWorkReceipt.fundSubmit?.status ? trustlessWorkReceipt.fundSubmit.status : "Not funded"}</dd></div>
              <div><dt>Last refresh</dt><dd>{trustlessWorkReceipt.refreshedAt ? new Date(trustlessWorkReceipt.refreshedAt).toLocaleString() : "Not refreshed"}</dd></div>
            </dl>
          </div>
          <div className="signal-receipt-footer">
            <div>
              <p>{mode === "live" ? "The Sub Rosa receipt is generated from a live ReceiptOnly round. The Trustless Work section only shows identifiers and tx hashes actually returned by the API." : "This sample workspace is a UI demonstration. It does not claim on-chain Sub Rosa transactions."}</p>
              {activeTxHashes.length > 0 && (
                <div className="signal-tx-list">
                  {activeTxHashes.map((hash) => (
                    <a key={hash} href={stellarExpertTxLink(hash)} target="_blank" rel="noreferrer">
                      <code>{shortHash(hash)}</code>
                      <ArrowRight size={13} />
                    </a>
                  ))}
                </div>
              )}
            </div>
            <div className="signal-receipt-actions">
              {mode === "live" && <button type="button" className="secondary-action compact" onClick={downloadReceipt} disabled={busy !== null || !sdk}><FileCheck2 size={15} />Download verified receipt</button>}
              <button type="button" className="secondary-action compact" onClick={() => setTrustlessWorkReceipt(emptyReceipt())} disabled={busy !== null}><X size={15} />Clear escrow evidence</button>
            </div>
          </div>
          {trustlessWorkReceipt.escrow?.milestones?.length ? (
            <div className="pilot-results">
              {trustlessWorkReceipt.escrow.milestones.map((milestone, index) => (
                <article className="pilot-result" key={`${milestone.description ?? "milestone"}-${index}`}>
                  <div className="pilot-result-heading">
                    <code>Milestone {index + 1}</code>
                    <span>{milestone.status ?? "pending"}</span>
                  </div>
                  <dl>
                    <div><dt>Description</dt><dd>{milestone.description ?? "Not set"}</dd></div>
                    <div><dt>Amount</dt><dd>{typeof milestone.amount === "number" ? `${milestone.amount.toLocaleString()} USDC` : "Not set"}</dd></div>
                    <div><dt>Receiver</dt><dd>{milestone.receiver ? shortAddr(milestone.receiver) : "Not set"}</dd></div>
                    <div><dt>Flags</dt><dd>{milestone.flags ? Object.entries(milestone.flags).filter(([, value]) => value).map(([key]) => key).join(", ") || "None" : "None"}</dd></div>
                  </dl>
                </article>
              ))}
            </div>
          ) : selectedProposal ? (
            <div className="pilot-results">
              {selectedProposal.data.milestones.map((milestone, index) => (
                <article className="pilot-result" key={`${selectedProposal.id}-${index}`}>
                  <div className="pilot-result-heading">
                    <code>Preview {index + 1}</code>
                    <span>planned</span>
                  </div>
                  <dl>
                    <div><dt>Description</dt><dd>{milestone.description}</dd></div>
                    <div><dt>Amount</dt><dd>{usdc(milestone.amount)} USDC</dd></div>
                    <div><dt>Receiver</dt><dd>{shortAddr(milestone.receiver)}</dd></div>
                    <div><dt>Delivery</dt><dd>{milestone.delivery}</dd></div>
                  </dl>
                </article>
              ))}
            </div>
          ) : null}
          <div className="signal-private-state" style={{ margin: "0 20px 20px" }}>
            <Sparkles size={18} />
            <div>
              <strong>{"Sub Rosa Round -> Selected proposal -> Trustless Work escrow"}</strong>
              <p>{trustlessWorkReceipt.escrowContractId ? "The bridge is live on testnet." : "The preview is ready once a proposal is selected and the Trustless Work API key is configured."}</p>
            </div>
          </div>
        </section>
      </section>
    </main>
  );
}

function UnlockIcon() {
  return <LockKeyhole size={16} />;
}
