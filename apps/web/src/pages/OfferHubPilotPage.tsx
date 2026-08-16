import { Buffer } from "buffer";
import { useEffect, useRef, useState } from "react";
import {
  getNetworkDetails,
  isConnected,
  requestAccess,
} from "@stellar/freighter-api";
import {
  type CoreV2Receipt,
  type RoundV2,
  parseReceiptV2,
  sealProposal,
  serializeReceiptV2,
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
  Clipboard,
  ExternalLink,
  FileCheck2,
  KeyRound,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";

import {
  CONTRACT_ID,
  NETWORK,
  NETWORK_LABEL,
  displayError,
  freighterError,
  resolveFreighterAddress,
  sha256Bytes,
  stellarExpertTxLink,
  useReadOnlyContract,
  useReadOnlySdk,
  useWalletContract,
} from "../lib/chain";
import { offerHubPilotRoundIdFromHash } from "../config/routing";
import { useDrandCountdown } from "../hooks/useDrandCountdown";
import { pilotRevealAction } from "../lib/pilotReveal";
import {
  canSelectOfferHubProvider,
  defaultOfferHubProposalDraft,
  defaultOfferHubWorkspace,
  deadlineSeconds,
  deriveOfferHubStage,
  offerHubEvidenceSummary,
  offerHubLiveConfigurationIssues,
  offerHubProposalFromSubmission,
  offerHubProposalDraftForProvider,
  offerHubProposalRows,
  offerHubSealedProposalForBidder,
  offerHubSealInputFromDraft,
  isOfferHubProposalDraftPristine,
  parseOfferHubWorkspace,
  selectOfferHubProvider,
  serializeOfferHubWorkspace,
  type OfferHubProposalDraft,
  type OfferHubProposalRecord,
  type OfferHubStage,
  type OfferHubWorkspace,
  buildOfferHubRoundParams,
  upsertOfferHubProposal,
  OFFER_HUB_STORAGE_KEY,
  OFFER_HUB_STAGE_LABELS,
} from "../lib/offerHubPilot";
import { decodePilotSubmission } from "../lib/pilotSubmission";
import {
  isRevealAlreadyOpen,
  isSubmissionAlreadyRevealed,
  isTxBadSeqError,
} from "../lib/pilotConcurrency";
import { useToast } from "../ui/Toast";
import { ConfettiBurst } from "../ui/Confetti";

type SignableTransaction<T> = { signAndSend: () => Promise<T> };

function shortAddress(value: string | undefined): string {
  if (!value) return "None";
  if (value.length <= 14) return value;
  return `${value.slice(0, 7)}…${value.slice(-7)}`;
}

function shortHash(value: string | undefined): string {
  if (!value) return "None";
  if (value.length <= 16) return value;
  return `${value.slice(0, 10)}…${value.slice(-8)}`;
}

function formatDeadline(deadlineAt: number, now: number): string {
  if (!deadlineAt) return "Not set";
  if (deadlineAt <= now) return "Deadline reached";
  const seconds = Math.max(0, Math.ceil((deadlineAt - now) / 1000));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${remainder.toString().padStart(2, "0")}`;
}

function loadWorkspace(): OfferHubWorkspace {
  if (typeof window === "undefined") return defaultOfferHubWorkspace();
  try {
    const raw = window.localStorage.getItem(OFFER_HUB_STORAGE_KEY);
    const base = raw ? parseOfferHubWorkspace(raw) : defaultOfferHubWorkspace();
    const hashRound = offerHubPilotRoundIdFromHash();
    return hashRound
      ? {
          ...base,
          mode: "live",
          roundId: hashRound,
          roundInput: hashRound,
        }
      : base;
  } catch {
    const fallback = defaultOfferHubWorkspace();
    const hashRound = offerHubPilotRoundIdFromHash();
    return hashRound
      ? {
          ...fallback,
          mode: "live",
          roundId: hashRound,
          roundInput: hashRound,
        }
      : fallback;
  }
}

function transactionHash(result: unknown): string | null {
  const hash = (result as { sendTransactionResponse?: { hash?: unknown } })
    .sendTransactionResponse?.hash;
  return typeof hash === "string" && hash ? hash : null;
}

function proposalIdFromDraft(draft: OfferHubProposalDraft): string {
  return draft.freelancerName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "proposal";
}

function proposalCardStatus(
  proposal: OfferHubProposalRecord,
  revealed: boolean,
  selected: boolean,
): string {
  if (selected) return "Selected";
  if (!revealed) return "Sealed";
  if (!proposal.valid) return "Needs review";
  return "Revealed";
}

function ProposalCard({
  proposal,
  index,
  revealed,
  selected,
  canSelect,
  onSelect,
}: {
  proposal: OfferHubProposalRecord;
  index: number;
  revealed: boolean;
  selected: boolean;
  canSelect: boolean;
  onSelect: (id: string) => void;
}) {
  const rows = offerHubProposalRows(proposal, revealed);
  return (
    <article className={`pilot-result offer-hub-proposal-card ${selected ? "selected" : ""}`}>
      <div className="pilot-result-heading">
        <span>{revealed ? proposal.providerMeta : `Proposal ${String(index + 1).padStart(2, "0")}`}</span>
        <strong className={proposal.valid ? "valid" : "invalid"}>{proposalCardStatus(proposal, revealed, selected)}</strong>
      </div>
      <dl className="pilot-facts offer-hub-proposal-facts">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <div className="pilot-actions offer-hub-card-actions">
        <button
          type="button"
          className={selected ? "secondary-action compact" : "primary-action compact"}
          onClick={() => onSelect(proposal.id)}
          disabled={!canSelect}
        >
          {selected ? "Selected provider" : "Select provider"} <ArrowRight size={15} />
        </button>
      </div>
    </article>
  );
}

function EvidencePanel({
  evidence,
  receipt,
  onDownloadReceipt,
  loading,
  transactionHashes,
}: {
  evidence: ReturnType<typeof offerHubEvidenceSummary>;
  receipt: CoreV2Receipt | null;
  onDownloadReceipt: () => void;
  loading: string | null;
  transactionHashes: string[];
}) {
  return (
    <section className="pilot-results-panel">
      <div className="pilot-panel-heading offer-hub-advanced-heading">
        <div>
          <span>{evidence.kind === "real" ? "Real testnet evidence" : "Demo evidence"}</span>
          <strong>{evidence.partnerWorkflow} / {evidence.subRosaMode}</strong>
        </div>
        <FileCheck2 size={20} />
      </div>
      <div className="pilot-results offer-hub-evidence">
        <div className="pilot-result">
          <div className="pilot-result-heading">
            <span className={evidence.kind === "real" ? "valid" : ""}>
              {evidence.kind === "real" ? "Sub Rosa receipt" : "Sample marketplace snapshot"}
            </span>
            <strong>{evidence.receiptAvailable ? "Ready" : "Demo only"}</strong>
          </div>
          <dl>
            <div>
              <dt>Partner workflow</dt>
              <dd>{evidence.partnerWorkflow}</dd>
            </div>
            <div>
              <dt>Sub Rosa mode</dt>
              <dd>{evidence.subRosaMode}</dd>
            </div>
            <div>
              <dt>Proposal count</dt>
              <dd>{evidence.proposalCount}</dd>
            </div>
            <div>
              <dt>Revealed</dt>
              <dd>{evidence.revealedCount}</dd>
            </div>
            <div>
              <dt>Selected provider</dt>
              <dd>{evidence.selectedProvider ?? "Not selected"}</dd>
            </div>
            <div>
              <dt>Round ID</dt>
              <dd>{evidence.roundId ?? "Sample only"}</dd>
            </div>
            <div>
              <dt>Contract ID</dt>
              <dd>{evidence.contractId ? shortAddress(evidence.contractId) : "Sample only"}</dd>
            </div>
            <div>
              <dt>Receipt</dt>
              <dd>{evidence.receiptAvailable ? (evidence.receiptVerified ? "Verified" : "Unavailable") : "Not claimed"}</dd>
            </div>
            <div>
              <dt>Protocol winner</dt>
              <dd>{evidence.protocolWinner ?? "None for ReceiptOnly"}</dd>
            </div>
          </dl>
        </div>

        {evidence.kind === "real" ? (
          <div className="pilot-result">
            <div className="pilot-result-heading">
              <span>Live receipt export</span>
              <strong>{receipt ? "Loaded" : "Not exported"}</strong>
            </div>
            <dl>
              <div>
                <dt>Receipt JSON</dt>
                <dd>{receipt ? "Available" : "Not exported yet"}</dd>
              </div>
              <div>
                <dt>Receipt round</dt>
                <dd>{receipt?.roundId ?? "None"}</dd>
              </div>
              <div>
                <dt>Receipt status</dt>
                <dd>{receipt?.status ?? "None"}</dd>
              </div>
              <div>
                <dt>Transaction hashes</dt>
                <dd>{transactionHashes.length}</dd>
              </div>
            </dl>
            <div className="pilot-actions offer-hub-card-actions">
              <button
                type="button"
                className="secondary-action compact"
                onClick={onDownloadReceipt}
                disabled={loading !== null}
              >
                <FileCheck2 size={15} />
                Download verified receipt
              </button>
            </div>
          </div>
        ) : (
          <div className="pilot-result">
            <div className="pilot-result-heading">
              <span>Demo only</span>
              <strong>Clear boundary</strong>
            </div>
            <p className="offer-hub-demo-note">
              Sample proposals and local selection state are only demo data. No fake contract ID,
              transaction hash, or Sub Rosa receipt is shown here.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

export function OfferHubPilotPage({ goHome }: { goHome: () => void }) {
  const toast = useToast();
  const [workspace, setWorkspace] = useState<OfferHubWorkspace>(() => loadWorkspace());
  const [round, setRound] = useState<RoundV2 | null>(null);
  const [liveProposals, setLiveProposals] = useState<OfferHubProposalRecord[]>([]);
  const [receipt, setReceipt] = useState<CoreV2Receipt | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [copied, setCopied] = useState(false);
  const [confettiTick, setConfettiTick] = useState(0);
  const previousComplete = useRef<string | null>(workspace.selectedProviderId);
  const refreshRequest = useRef(0);
  const contract = useWalletContract(address);
  const reader = useReadOnlyContract();
  const sdk = useReadOnlySdk();

  const currentProposals = workspace.mode === "live" ? liveProposals : workspace.sampleProposals;
  const revealedCount = currentProposals.filter((proposal) => proposal.revealed).length;
  const proposalCount = currentProposals.length;
  const selectedProposal = currentProposals.find((proposal) => proposal.id === workspace.selectedProviderId) ?? null;
  const selectedProviderName = selectedProposal?.providerName ?? null;
  const activeReceipt = receipt?.roundId === workspace.roundId ? receipt : null;
  const deadlineRemaining = Math.max(0, Math.ceil((workspace.deadlineAt - now) / 1000));
  const deadlinePassed = workspace.mode === "live"
    ? Boolean(round && (round.status.tag !== "Open" || Number(round.commit_deadline) * 1000 <= now))
    : workspace.deadlineAt <= now;
  const allRevealed = proposalCount > 0 && revealedCount >= proposalCount;
  const workflowStage: OfferHubStage = deriveOfferHubStage({
    roundId: workspace.roundId,
    protocolStatus: round?.status.tag ?? null,
    deadlineAt: workspace.deadlineAt,
    now,
    proposalCount,
    revealedCount,
    selectedProviderId: selectedProposal?.id ?? null,
  });
  const revealCountdown = useDrandCountdown(round ? Number(round.reveal_round) : 0);
  const revealAction = pilotRevealAction(
    round?.status.tag ?? "Open",
    workspace.mode === "live"
      ? revealCountdown.published
      : deadlineRemaining === 0,
    workspace.mode === "live"
      ? revealCountdown.secondsRemaining
      : deadlineRemaining,
    allRevealed,
  );
  const liveReady = Boolean(address && contract && reader && sdk);
  const liveConfigurationIssues = offerHubLiveConfigurationIssues({
    contractId: CONTRACT_ID ?? null,
    walletAddress: address,
  });
  const evidence = offerHubEvidenceSummary({
    mode: workspace.mode,
    proposalCount,
    revealedCount,
    selectedProviderName,
    roundId: workspace.roundId,
    contractId: CONTRACT_ID ?? null,
    receipt: activeReceipt,
    receiptVerified: workspace.receiptVerified,
  });

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(OFFER_HUB_STORAGE_KEY, serializeOfferHubWorkspace(workspace));
  }, [workspace]);

  useEffect(() => {
    if (!previousComplete.current && workspace.selectedProviderId) {
      setConfettiTick((current) => current + 1);
    }
    previousComplete.current = workspace.selectedProviderId;
  }, [workspace.selectedProviderId]);

  useEffect(() => {
    if (!workspace.receiptJson || receipt) return;
    try {
      const storedReceipt = parseReceiptV2(workspace.receiptJson);
      const verification = verifyReceiptV2(storedReceipt);
      if (!verification.valid) {
        setWorkspace((current) => ({
          ...current,
          receiptJson: null,
          receiptVerified: false,
        }));
        return;
      }
      setReceipt(storedReceipt);
      if (workspace.receiptVerified !== verification.valid) {
        setWorkspace((current) => ({ ...current, receiptVerified: verification.valid }));
      }
    } catch {
      setWorkspace((current) => ({
        ...current,
        receiptJson: null,
        receiptVerified: null,
      }));
    }
  }, [receipt, workspace.receiptJson]);

  useEffect(() => {
    const onHashChange = () => {
      const hashRound = offerHubPilotRoundIdFromHash();
      if (!hashRound) return;
      setWorkspace((current) => ({
        ...current,
        mode: "live",
        roundId: hashRound,
        roundInput: hashRound,
      }));
    };

    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [reader, contract]);

  useEffect(() => {
    if (!reader || workspace.mode !== "live" || !workspace.roundId) return;
    void refreshLive(workspace.roundId).catch((error) =>
      toast.push("error", "Live round load failed", displayError(error)),
    );
  }, [reader, workspace.mode, workspace.roundId]);

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
      setWorkspace((current) => ({
        ...current,
        mode: "live",
        proposalDraft: isOfferHubProposalDraftPristine(current.proposalDraft)
          ? offerHubProposalDraftForProvider(nextAddress)
          : current.proposalDraft,
      }));
      toast.push("success", "Wallet connected", shortAddress(nextAddress));
    } catch (error) {
      toast.push("error", "Wallet connection failed", displayError(error));
    } finally {
      setBusy(null);
    }
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
        await new Promise((resolve) => window.setTimeout(resolve, 900));
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error(displayError(lastError));
  }

  async function refreshLive(target = workspace.roundId ?? workspace.roundInput) {
    if (!reader || !target || !/^\d+$/.test(target)) return null;
    const request = ++refreshRequest.current;
    const rid = BigInt(target);
    const roundTx = await reader.get_round_v2({ round_id: rid });
    const nextRound = roundTx.result.unwrap();
    const proposals = await Promise.all(
      nextRound.bidders.map(async (bidder) => {
        const submission = (
          await reader.get_submission_v2({ round_id: rid, bidder })
        ).result.unwrap();
        if (submission.revealed_envelope == null) {
          return offerHubSealedProposalForBidder(bidder);
        }
        return offerHubProposalFromSubmission(
          decodePilotSubmission(
            bidder,
            nextRound.mode.tag,
            new Uint8Array(submission.revealed_envelope),
            submission.valid,
          ),
        );
      }),
    );
    if (request !== refreshRequest.current) return nextRound;
    setRound(nextRound);
    setLiveProposals(proposals);
    setWorkspace((current) => ({
      ...current,
      mode: "live",
      roundId: target,
      roundInput: target,
      deadlineAt: Number(nextRound.commit_deadline) * 1000,
    }));
    return nextRound;
  }

  async function createLiveRound() {
    if (!contract || !address) {
      toast.push("error", "Wallet required", "Connect Freighter before creating a live Offer-Hub round.");
      return;
    }
    if (!workspace.job.title.trim()) {
      toast.push("error", "Job title required", "Enter the job details before creating a round.");
      return;
    }
    if (!workspace.job.sealedProposalsEnabled) {
      toast.push("error", "Sealed proposals disabled", "Enable the private proposal mode first.");
      return;
    }
    setBusy("create");
    try {
      const drand = quicknet();
      const commitSeconds = deadlineSeconds(workspace.deadlinePreset);
      const revealRound = await roundInSeconds(drand, commitSeconds + 15);
      const info = await drand.chain().info();
      const revealAt = Number(info.genesis_time) + Number(info.period) * revealRound;
      const auditor = generateAuditorKeypair();
      const itemRef = await sha256Bytes(`${workspace.job.title}:${address}:${Date.now()}`);
      const params = buildOfferHubRoundParams({
        job: workspace.job,
        operator: address,
        itemRef,
        revealRound,
        commitDeadline: revealAt - 10,
        revealDeadline: revealAt + 300,
        auditorPubkey: auditor.publicKey,
      });
      const commonArgs = {
        operator: params.operator ?? address,
        item_ref: Buffer.from(params.itemRef),
        schema_ref: Buffer.from(params.schemaRef),
        reveal_round: BigInt(params.revealRound),
        clearing_rule: { tag: "LowestBid", values: undefined },
        commit_deadline: BigInt(params.commitDeadline),
        reveal_deadline: BigInt(params.revealDeadline),
        auditor_pubkey: Buffer.from(params.auditorPubkey),
        max_participants: params.maxParticipants ?? 25,
      } as const;
      const settlement = {
        mode: { tag: "ReceiptOnly" as const, values: undefined },
        payment_asset: undefined,
        lot_asset: undefined,
        lot_amount: 0n,
      };
      const sent = await signAndSendWithSequenceRetry(() => contract.create_round_v2({
        ...commonArgs,
        settlement,
      }));
      const nextId = sent.result.unwrap().toString();
      const hash = transactionHash(sent);
      setWorkspace((current) => ({
        ...current,
        mode: "live",
        roundId: nextId,
        roundInput: nextId,
        deadlineAt: (revealAt - 10) * 1000,
        selectedProviderId: null,
        selectedProviderName: null,
        receiptJson: null,
        receiptVerified: null,
        transactionHashes: hash ? Array.from(new Set([...current.transactionHashes, hash])) : current.transactionHashes,
      }));
      setRound(null);
      setLiveProposals([]);
      setReceipt(null);
      window.location.hash = `#/pilot/offer-hub/${nextId}`;
      toast.push("success", "Live round created", `ReceiptOnly round #${nextId}`);
      void refreshLive(nextId).catch((error) =>
        toast.push("error", "Round created, but refresh failed", displayError(error)),
      );
    } catch (error) {
      toast.push("error", "Round creation failed", displayError(error));
    } finally {
      setBusy(null);
    }
  }

  async function loadLiveRound(target = workspace.roundInput) {
    if (!target.trim()) {
      toast.push("error", "Round ID required", "Enter a numeric round ID first.");
      return;
    }
    if (!reader) {
      toast.push("error", "Read-only contract unavailable", "Check the configured Sub Rosa network first.");
      return;
    }
    if (!/^\d+$/.test(target.trim())) {
      toast.push("error", "Round ID invalid", "Round IDs must be whole numbers.");
      return;
    }
    setBusy("load");
    try {
      const nextRound = await refreshLive(target.trim());
      if (!nextRound) throw new Error("Round data is not available yet.");
      setWorkspace((current) => ({
        ...current,
        mode: "live",
        roundId: target.trim(),
        roundInput: target.trim(),
      }));
      toast.push("success", "Live round loaded", `ReceiptOnly round #${target.trim()}`);
    } catch (error) {
      toast.push("error", "Live round load failed", displayError(error));
    } finally {
      setBusy(null);
    }
  }

  async function submitProposal() {
    setBusy("submit");
    try {
      const sealedInput = offerHubSealInputFromDraft(workspace.proposalDraft);
      if (workspace.mode === "sample") {
        const nextProposal: OfferHubProposalRecord = {
          id: `demo-${proposalIdFromDraft(workspace.proposalDraft)}`,
          providerName: sealedInput.providerName,
          providerMeta: sealedInput.providerMeta,
          submittedAt: Date.now(),
          revealed: false,
          valid: true,
          source: "demo",
          data: sealedInput.recordData,
        };
        setWorkspace((current) => ({
          ...current,
          sampleProposals: upsertOfferHubProposal(current.sampleProposals, nextProposal),
        }));
        toast.push("success", "Sample proposal stored", "Local demo proposal updated.");
        return;
      }

      if (!contract || !address || !round || !workspace.roundId) {
        throw new Error("Connect a wallet and load a live round first.");
      }
      if (round.status.tag !== "Open") {
        throw new Error(`This round is already ${round.status.tag.toLowerCase()}.`);
      }
      const liveRoundId = workspace.roundId;
      const drand = quicknet();
      const sealed = await sealProposal({
        round: Number(round.reveal_round),
        drand,
        price: sealedInput.price,
        proposal: sealedInput.proposal,
        identity: new TextEncoder().encode(address),
        auditorPublicKey: new Uint8Array(round.auditor_pubkey),
      });
      const sent = await signAndSendWithSequenceRetry(() => contract.commit_v2({
        round_id: BigInt(liveRoundId),
        bidder: address,
        commitment: Buffer.from(sealed.commitment),
        ciphertext: Buffer.from(sealed.ciphertext),
        escrow: 0n,
        auditor_blob: Buffer.from(sealed.auditorBlob),
      }));
      const hash = transactionHash(sent);
      setWorkspace((current) => ({
        ...current,
        transactionHashes: hash ? Array.from(new Set([...current.transactionHashes, hash])) : current.transactionHashes,
      }));
      await refreshLive();
      toast.push("success", "Private proposal submitted", `Sealed on ReceiptOnly round #${liveRoundId}`);
    } catch (error) {
      toast.push("error", "Proposal submission failed", displayError(error));
    } finally {
      setBusy(null);
    }
  }

  async function revealProposals() {
    if (workspace.mode === "sample") {
      setWorkspace((current) => ({
        ...current,
        sampleProposals: current.sampleProposals.map((proposal) => ({ ...proposal, revealed: true })),
      }));
      toast.push("success", "Sample proposals revealed", "Local demo proposals are now visible.");
      return;
    }

    if (!contract || !round || !workspace.roundId) {
      toast.push("error", "Live round required", "Create or load a live round first.");
      return;
    }
    if (round.status.tag === "Open" && !revealCountdown.published) return;
    setBusy("reveal");
    try {
      const rid = BigInt(workspace.roundId);
      const drand = quicknet();
      let current = (await contract.get_round_v2({ round_id: rid })).result.unwrap();
      if (current.status.tag === "Open") {
        const signature = await fetchRoundSignature(drand, Number(current.reveal_round));
        try {
          const sent = await signAndSendWithSequenceRetry(() => contract.open_reveal_v2({
            round_id: rid,
            drand_signature: Buffer.from(signature),
          }));
          const hash = transactionHash(sent);
          if (hash) {
            setWorkspace((state) => ({
              ...state,
              transactionHashes: Array.from(new Set([...state.transactionHashes, hash])),
            }));
          }
        } catch (error) {
          if (!isRevealAlreadyOpen(error)) throw error;
        }
        current = (await contract.get_round_v2({ round_id: rid })).result.unwrap();
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
        if (!seal) throw new Error(`Encrypted proposal is unavailable for ${shortAddress(bidder)}`);
        const envelope = await openPayload(new Uint8Array(seal.ciphertext), drand);
        try {
          const sent = await signAndSendWithSequenceRetry(() => contract.reveal_v2({
            round_id: rid,
            bidder,
            envelope: Buffer.from(encodePayloadEnvelope(envelope)),
          }));
          const hash = transactionHash(sent);
          if (hash) {
            setWorkspace((state) => ({
              ...state,
              transactionHashes: Array.from(new Set([...state.transactionHashes, hash])),
            }));
          }
          revealedCount += 1;
        } catch (error) {
          if (!isSubmissionAlreadyRevealed(error)) throw error;
          alreadyRevealedCount += 1;
        }
      }

      await refreshLive();
      current = (await contract.get_round_v2({ round_id: rid })).result.unwrap();
      if (current.status.tag === "Revealing") {
        const clearSent = await signAndSendWithSequenceRetry(() => (
          contract.clear_v2({ round_id: rid })
        ));
        const clearHash = transactionHash(clearSent);
        if (clearHash) {
          setWorkspace((state) => ({
            ...state,
            transactionHashes: Array.from(new Set([...state.transactionHashes, clearHash])),
          }));
        }
      }

      await refreshLive();
      toast.push(
        "success",
        "Proposals revealed",
        `${revealedCount} new, ${alreadyRevealedCount} already open, ${bidders.length} participant(s) total`,
      );
    } catch (error) {
      await refreshLive().catch(() => null);
      toast.push("error", "Reveal failed", displayError(error));
    } finally {
      setBusy(null);
    }
  }

  async function selectProvider(providerId: string) {
    try {
      const next = selectOfferHubProvider(currentProposals, providerId, workflowStage);
      setWorkspace((current) => ({
        ...current,
        selectedProviderId: next.selectedProviderId,
        selectedProviderName: next.selectedProviderName,
      }));
      toast.push("success", "Provider selected", next.selectedProviderName);
    } catch (error) {
      toast.push("error", "Selection failed", displayError(error));
    }
  }

  async function downloadReceipt() {
    if (!sdk || !workspace.roundId || workspace.mode !== "live") {
      toast.push(
        "error",
        "Live receipt unavailable",
        "Configure Sub Rosa and create or load a live round before exporting evidence.",
      );
      return;
    }
    setBusy("receipt");
    try {
      const exportReceipt = await sdk.exportReceiptV2(BigInt(workspace.roundId));
      const verification = verifyReceiptV2(exportReceipt);
      if (!verification.valid) throw new Error("Receipt verification failed");
      const json = serializeReceiptV2(exportReceipt);
      setReceipt(exportReceipt);
      setWorkspace((current) => ({
        ...current,
        receiptJson: json,
        receiptVerified: verification.valid,
      }));
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `sub-rosa-offer-hub-round-${workspace.roundId}-receipt.json`;
      link.click();
      URL.revokeObjectURL(url);
      toast.push("success", "Receipt verified", `Round #${workspace.roundId}`);
    } catch (error) {
      toast.push("error", "Receipt export failed", displayError(error));
    } finally {
      setBusy(null);
    }
  }

  async function copyLink() {
    const suffix = workspace.roundId ? `/${workspace.roundId}` : "";
    const url = `${window.location.origin}${window.location.pathname}#/pilot/offer-hub${suffix}`;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  function updateJob<K extends keyof OfferHubWorkspace["job"]>(key: K, value: OfferHubWorkspace["job"][K]) {
    setWorkspace((current) => ({
      ...current,
      job: {
        ...current.job,
        [key]: value,
      },
    }));
  }

  function updateDraft<K extends keyof OfferHubProposalDraft>(key: K, value: OfferHubProposalDraft[K]) {
    setWorkspace((current) => ({
      ...current,
      proposalDraft: {
        ...current.proposalDraft,
        [key]: value,
      },
    }));
  }

  function switchMode(mode: OfferHubWorkspace["mode"]) {
    setWorkspace((current) => ({
      ...current,
      mode,
      proposalDraft: mode === "live" && address
        ? offerHubProposalDraftForProvider(address)
        : defaultOfferHubProposalDraft(),
    }));
  }

  function resetProposalForm() {
    setWorkspace((current) => ({
      ...current,
      proposalDraft: current.mode === "live" && address
        ? offerHubProposalDraftForProvider(address, Date.now())
        : defaultOfferHubProposalDraft(),
    }));
  }

  function resetWorkspace() {
    const next = defaultOfferHubWorkspace();
    setWorkspace(next);
    setRound(null);
    setLiveProposals([]);
    setReceipt(null);
    window.location.hash = "#/pilot/offer-hub";
  }

  const flowSteps = [
    { label: "Job created", done: true },
    { label: "Sealed proposals", done: proposalCount > 0 },
    { label: "Deadline reached", done: deadlinePassed },
    { label: "Revealed", done: revealedCount > 0 && allRevealed },
    { label: "Provider selected", done: Boolean(workspace.selectedProviderId) },
  ];

  const currentNetworkLabel = workspace.mode === "live"
    ? `${NETWORK_LABEL} · Live ReceiptOnly`
    : "Sample Offer-Hub-style marketplace data";

  return (
    <main className="pilot-page offer-hub-pilot-page">
      <ConfettiBurst fire={confettiTick} count={36} />
      <nav className="pilot-nav">
        <button type="button" className="brand-link" onClick={goHome}>
          <img src="/sub-rosa-logo.png" alt="" />
          <span>Sub Rosa</span>
        </button>
        <div className="pilot-nav-actions">
          <span className="pilot-network">{currentNetworkLabel}</span>
          <div className="pilot-template-switch" role="tablist" aria-label="Workspace mode">
            <button
              type="button"
              className={workspace.mode === "sample" ? "active" : ""}
              onClick={() => switchMode("sample")}
            >
              Sample
            </button>
            <button
              type="button"
              className={workspace.mode === "live" ? "active" : ""}
              onClick={() => switchMode("live")}
            >
              Live
            </button>
          </div>
          <a
            href="https://www.offer-hub.org/labs/sub-rosa"
            className="secondary-action compact"
            target="_blank"
            rel="noreferrer"
          >
            <ExternalLink size={15} />
            Offer-Hub pilot
          </a>
          <a href="#/docs" className="secondary-action compact">Docs</a>
          <button type="button" className="secondary-action compact" onClick={connect} disabled={busy !== null}>
            {address ? shortAddress(address) : busy === "connect" ? "Connecting..." : "Connect wallet"}
          </button>
        </div>
      </nav>

      <section className="pilot-header offer-hub-hero">
        <div>
          <span className="pilot-kicker"><ShieldCheck size={15} /> Optional sealed proposals</span>
          <h1>Offer-Hub</h1>
          <p>
            Let clients collect freelancer proposals privately and reveal them together at the
            deadline before selecting a provider. Offer-Hub keeps its marketplace, subscriptions,
            and payment logic.
          </p>
          <div className="pilot-boundary">
            Sub Rosa provides the private proposal layer. Offer-Hub keeps its marketplace and
            selection logic.
          </div>
        </div>
        <div className="pilot-partner-identity offer-hub-partner-identity">
          <img className="pilot-partner-mark" src="/pilots/offer-hub/offer-hub.jpg" alt="Offer-Hub" />
          <div className="pilot-template-switch" role="tablist" aria-label="Pilot view">
            <button
              type="button"
              className={workspace.view === "client" ? "active" : ""}
              onClick={() => setWorkspace((current) => ({ ...current, view: "client" }))}
            >
              Client / organizer
            </button>
            <button
              type="button"
              className={workspace.view === "provider" ? "active" : ""}
              onClick={() => setWorkspace((current) => ({ ...current, view: "provider" }))}
            >
              Freelancer / provider
            </button>
          </div>
        </div>
      </section>

      <section className="signal-pilot-flow offer-hub-flow" aria-label="Offer-Hub workflow">
        {flowSteps.map((step, index) => (
          <div className={step.done ? "done" : ""} key={step.label}>
            <span>{step.done ? <CheckCircle2 size={15} /> : index + 1}</span>
            <strong>{step.label}</strong>
            {index < flowSteps.length - 1 && <ArrowRight size={15} aria-hidden="true" />}
          </div>
        ))}
      </section>

      {!liveReady && workspace.mode === "live" && (
        <div className="pilot-alert">
          Configuration required: {liveConfigurationIssues.join(" ")} Sample mode remains usable
          without blockchain activity.
        </div>
      )}

      <section className="pilot-layout offer-hub-layout">
        <div className="pilot-panel offer-hub-primary">
          <div className="pilot-panel-heading">
            <div>
              <span>{workspace.mode === "live" ? `${NETWORK_LABEL} · ReceiptOnly` : "Sample workspace"}</span>
              <h2>{workspace.view === "client" ? "Client / organizer view" : "Freelancer / provider view"}</h2>
            </div>
            <span className={`pilot-status ${workflowStage}`}>
              {OFFER_HUB_STAGE_LABELS[workflowStage]}
            </span>
          </div>

          <div className="offer-hub-main">
            <section className="pilot-result">
              <div className="pilot-result-heading">
                <span>Job</span>
                <strong>{workspace.job.sealedProposalsEnabled ? "Sealed proposals on" : "Sealed proposals off"}</strong>
              </div>
              <dl className="pilot-facts offer-hub-job-facts">
                <div><dt>Title</dt><dd>{workspace.job.title}</dd></div>
                <div><dt>Description</dt><dd>{workspace.job.description}</dd></div>
                <div><dt>Budget</dt><dd>{workspace.job.budget}</dd></div>
                <div><dt>Deadline</dt><dd>{formatDeadline(workspace.deadlineAt, now)}</dd></div>
                <div><dt>Proposals</dt><dd>{proposalCount}</dd></div>
                <div><dt>Selection</dt><dd>{selectedProviderName ?? "Not selected"}</dd></div>
              </dl>
              <p className="offer-hub-muted-note">{workspace.job.eligibilityNote}</p>
              <div className="pilot-actions offer-hub-card-actions">
                <button type="button" className="secondary-action compact" onClick={copyLink}>
                  <Clipboard size={15} />
                  {copied ? "Copied" : "Copy workspace link"}
                </button>
                <button type="button" className="secondary-action compact" onClick={resetWorkspace}>
                  <RefreshCw size={15} />
                  Reset workspace
                </button>
              </div>
            </section>

            {workspace.view === "client" ? (
              <>
                <section className="pilot-result">
                  <div className="pilot-result-heading">
                    <span>Round operations</span>
                    <strong>{workspace.mode === "live" ? "Testnet round" : "Sample round"}</strong>
                  </div>
                  <div className="offer-hub-form offer-hub-job-form">
                    <label>Job title<input value={workspace.job.title} onChange={(event) => updateJob("title", event.target.value)} /></label>
                    <label>Job description<textarea rows={3} value={workspace.job.description} onChange={(event) => updateJob("description", event.target.value)} /></label>
                    <label>Budget<input value={workspace.job.budget} onChange={(event) => updateJob("budget", event.target.value)} /></label>
                    <label>Proposal deadline
                      <select value={workspace.deadlinePreset} onChange={(event) => {
                        const preset = event.target.value as OfferHubWorkspace["deadlinePreset"];
                        setWorkspace((current) => ({
                          ...current,
                          deadlinePreset: preset,
                          deadlineAt: Date.now() + deadlineSeconds(preset) * 1000,
                        }));
                      }}>
                        <option value="2m">2 minutes</option>
                        <option value="5m">5 minutes</option>
                        <option value="1d">1 day</option>
                      </select>
                    </label>
                    <label className="offer-hub-checkbox">
                      <input type="checkbox" checked={workspace.job.sealedProposalsEnabled} onChange={(event) => updateJob("sealedProposalsEnabled", event.target.checked)} />
                      Private / Sealed Proposals
                    </label>
                    {workspace.mode === "live" && (
                      <label>Existing round ID
                        <input inputMode="numeric" placeholder="e.g. 42" value={workspace.roundInput} onChange={(event) => setWorkspace((current) => ({ ...current, roundInput: event.target.value }))} />
                      </label>
                    )}
                  </div>
                  <div className="pilot-actions offer-hub-card-actions">
                    {workspace.mode === "live" ? (
                      <>
                        <button type="button" className="primary-action compact" onClick={createLiveRound} disabled={busy !== null}>
                          <ShieldCheck size={15} />
                          {busy === "create" ? "Creating..." : "Create live round"}
                        </button>
                        <button type="button" className="secondary-action compact" onClick={() => void loadLiveRound()} disabled={busy !== null || !workspace.roundInput.trim()}>
                          <RefreshCw size={15} />
                          Load round
                        </button>
                      </>
                    ) : (
                      <>
                        <button type="button" className="primary-action compact" onClick={revealProposals} disabled={busy !== null || !deadlinePassed}>
                          <Sparkles size={15} />
                          {deadlinePassed || allRevealed ? "Reveal sample proposals" : `Reveal in ${deadlineRemaining}s`}
                        </button>
                        <button type="button" className="secondary-action compact" onClick={() => setWorkspace((current) => ({ ...current, deadlineAt: Date.now() - 1000 }))}>
                          <LockKeyhole size={15} />
                          Simulate deadline
                        </button>
                      </>
                    )}
                    {revealAction.visible && workspace.mode === "live" && (
                      <button
                        type="button"
                        className="primary-action compact"
                        onClick={revealProposals}
                        disabled={busy !== null || !revealAction.ready}
                      >
                        <UnlockLabel ready={revealAction.ready} label={revealAction.label} busy={busy === "reveal"} />
                      </button>
                    )}
                  </div>
                  <div className="offer-hub-room-note">
                    <LockKeyhole size={15} />
                    {workspace.mode === "live"
                      ? "Sub Rosa handles sealing, reveal, and receipts. Offer-Hub still chooses the provider manually."
                      : "Sample mode keeps the UI interactive without claiming blockchain activity."}
                  </div>
                </section>

                <section className="pilot-result">
                  <div className="pilot-result-heading">
                    <span>Visible proposals</span>
                    <strong>{revealedCount}/{proposalCount}</strong>
                  </div>
                  {proposalCount === 0 ? (
                    <div className="pilot-empty">No proposals submitted yet.</div>
                  ) : (
                    <div className="offer-hub-proposal-grid">
                      {currentProposals.map((proposal, index) => (
                        <ProposalCard
                          key={proposal.id}
                          proposal={proposal}
                          index={index}
                          revealed={proposal.revealed}
                          selected={workspace.selectedProviderId === proposal.id}
                          canSelect={canSelectOfferHubProvider(workflowStage) && proposal.revealed}
                          onSelect={(id) => void selectProvider(id)}
                        />
                      ))}
                    </div>
                  )}
                </section>
              </>
            ) : (
              <>
                <section className="pilot-result">
                  <div className="pilot-result-heading">
                    <span>Provider submission</span>
                    <strong>{workspace.mode === "live" ? "Live sealed proposal" : "Demo proposal"}</strong>
                  </div>
                  <dl className="pilot-facts offer-hub-job-facts">
                    <div><dt>Public job</dt><dd>{workspace.job.title}</dd></div>
                    <div><dt>Budget</dt><dd>{workspace.job.budget}</dd></div>
                    <div><dt>Privacy</dt><dd>Your proposal stays private until the shared deadline.</dd></div>
                    <div><dt>Status</dt><dd>{workflowStage === "revealed" || workflowStage === "selected" ? "Revealed" : "Sealed"}</dd></div>
                  </dl>
                  <p className="offer-hub-muted-note">
                    Freelancers see the job, not competing proposals. Offer-Hub keeps discovery and
                    selection inside its product.
                  </p>
                </section>

                <section className="pilot-result">
                  <div className="pilot-result-heading">
                    <span>{workspace.mode === "live" ? "Freelancer proposal form" : "Sample proposal form"}</span>
                    <strong>{address ? shortAddress(address) : "No wallet connected"}</strong>
                  </div>
                  <div className="offer-hub-form">
                    <label>Freelancer name<input value={workspace.proposalDraft.freelancerName} onChange={(event) => updateDraft("freelancerName", event.target.value)} /></label>
                    <label>Profile / role<input value={workspace.proposalDraft.providerMeta} onChange={(event) => updateDraft("providerMeta", event.target.value)} /></label>
                    <label>Proposed price (USDC)<input inputMode="decimal" value={workspace.proposalDraft.proposedPrice} onChange={(event) => updateDraft("proposedPrice", event.target.value)} /></label>
                    <label>Estimated delivery days<input inputMode="numeric" value={workspace.proposalDraft.estimatedDeliveryDays} onChange={(event) => updateDraft("estimatedDeliveryDays", event.target.value)} /></label>
                    <label>Short proposal<textarea rows={3} value={workspace.proposalDraft.shortProposal} onChange={(event) => updateDraft("shortProposal", event.target.value)} /></label>
                    <label>Relevant experience<textarea rows={3} value={workspace.proposalDraft.relevantExperience} onChange={(event) => updateDraft("relevantExperience", event.target.value)} /></label>
                    <label>Optional milestone summary<textarea rows={3} value={workspace.proposalDraft.milestoneSummary} onChange={(event) => updateDraft("milestoneSummary", event.target.value)} /></label>
                    <div className="pilot-actions offer-hub-card-actions">
                      <button type="button" className="primary-action compact" onClick={() => void submitProposal()} disabled={busy !== null || (workspace.mode === "live" && (!address || !round || !workspace.roundId))}>
                        <LockKeyhole size={15} />
                        {workspace.mode === "live" ? (busy === "submit" ? "Waiting..." : "Submit sealed proposal") : "Submit sample proposal"}
                      </button>
                      <button type="button" className="secondary-action compact" onClick={resetProposalForm}>
                        <RefreshCw size={15} />
                        {workspace.mode === "live" ? "Generate new values" : "Reset form"}
                      </button>
                    </div>
                  </div>
                  <p className="offer-hub-muted-note">
                    {workspace.mode === "live"
                      ? "The proposal is encrypted locally, then commit_v2 is signed by the connected wallet."
                      : "Sample mode stores demo-only marketplace data locally and never claims a real transaction."}
                  </p>
                </section>

                <section className="pilot-result">
                  <div className="pilot-result-heading">
                    <span>Submission status</span>
                    <strong>{workspace.mode === "live" && address ? shortAddress(address) : workspace.proposalDraft.freelancerName}</strong>
                  </div>
                  {workspace.mode === "live" && address ? (
                    <dl className="pilot-facts offer-hub-job-facts">
                      <div><dt>Wallet</dt><dd>{shortAddress(address)}</dd></div>
                      <div><dt>Round</dt><dd>{workspace.roundId ? `#${workspace.roundId}` : "Not loaded"}</dd></div>
                      <div><dt>Reveal gate</dt><dd>{revealAction.label}</dd></div>
                      <div><dt>Submission</dt><dd>{liveProposals.find((proposal) => proposal.wallet === address)?.revealed ? "Revealed" : "Sealed or pending"}</dd></div>
                    </dl>
                  ) : (
                    <dl className="pilot-facts offer-hub-job-facts">
                      <div><dt>Wallet</dt><dd>Not required in sample mode</dd></div>
                      <div><dt>Draft</dt><dd>{workspace.proposalDraft.freelancerName}</dd></div>
                      <div><dt>Local state</dt><dd>{workspace.sampleProposals.some((proposal) => proposal.providerName === workspace.proposalDraft.freelancerName) ? "Stored" : "Not stored yet"}</dd></div>
                      <div><dt>Privacy</dt><dd>Demo-only</dd></div>
                    </dl>
                  )}
                </section>
              </>
            )}
          </div>
        </div>

        <aside className="pilot-panel offer-hub-sidebar">
          <div className="pilot-panel-heading">
            <div>
              <span>Evidence</span>
              <h2>SCF-friendly record</h2>
            </div>
            <span className="signal-demo-badge">{workspace.mode === "live" ? "REAL" : "DEMO"}</span>
          </div>
          <EvidencePanel
            evidence={evidence}
            receipt={activeReceipt}
            onDownloadReceipt={() => void downloadReceipt()}
            loading={busy}
            transactionHashes={workspace.transactionHashes}
          />
          <div className="pilot-result offer-hub-boundary-panel">
            <div className="pilot-result-heading">
              <span>Protocol boundary</span>
              <strong>What Sub Rosa owns</strong>
            </div>
            <dl className="pilot-facts">
              <div><dt>Offer-Hub</dt><dd>Discovery, profiles, subscriptions, eligibility, selection, payment</dd></div>
              <div><dt>Sub Rosa</dt><dd>Private proposals, deadline, reveal, receipt, verification</dd></div>
              <div><dt>Winner logic</dt><dd>Always application-level in ReceiptOnly</dd></div>
              <div><dt>Fee path</dt><dd>Wallet-signed Stellar transaction</dd></div>
            </dl>
          </div>
        </aside>

        {workspace.mode === "live" && workspace.transactionHashes.length > 0 && (
          <section className="pilot-results-panel offer-hub-tx-panel">
            <div className="pilot-panel-heading offer-hub-advanced-heading">
              <div>
                <span>Transaction evidence</span>
                <strong>Live hashes only</strong>
              </div>
              <ExternalLink size={18} />
            </div>
            <div className="pilot-results">
              <div className="pilot-result">
                <dl>
                  {workspace.transactionHashes.map((hash) => (
                    <div key={hash}>
                      <dt>Tx hash</dt>
                      <dd>
                        <a href={stellarExpertTxLink(hash)} target="_blank" rel="noreferrer">
                          <code>{shortHash(hash)}</code>
                        </a>
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            </div>
          </section>
        )}
      </section>

      <footer className="signal-pilot-footer">
        <span><KeyRound size={14} />Standalone pilot environment</span>
        <span>Offer-Hub keeps its marketplace and selection logic. Sub Rosa only supplies the sealed proposal layer.</span>
        <a href="#/docs">Read the integration docs<X size={13} /></a>
      </footer>
    </main>
  );
}

function UnlockLabel({
  ready,
  label,
  busy,
}: {
  ready: boolean;
  label: string;
  busy: boolean;
}) {
  return (
    <>
      <Sparkles size={15} />
      {busy ? "Revealing..." : ready ? "Reveal proposals" : label}
    </>
  );
}
