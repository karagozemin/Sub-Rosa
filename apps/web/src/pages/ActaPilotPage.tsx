import { drandRoundTime } from "@sub-rosa/tlock";
import { Buffer } from "buffer";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  getNetworkDetails,
  isConnected,
  requestAccess,
  signTransaction as freighterSignTransaction,
} from "@stellar/freighter-api";
import {
  type CoreV2Receipt,
  type RoundV2,
  sealProposal,
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
  BadgeCheck,
  CheckCircle2,
  ExternalLink,
  FileCheck2,
  KeyRound,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  UserCheck,
} from "lucide-react";

import { actaPilotRoundIdFromHash } from "../config/routing";
import { useDrandCountdown } from "../hooks/useDrandCountdown";
import {
  ActaAdapter,
  ACTA_TESTNET_BASE_URL,
  isValidActaIssuerDid,
  type ActaEligibilityReference,
  type ActaOutcomeType,
} from "../integrations/acta";
import {
  CONTRACT_ID,
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
import {
  ACTA_PILOT_STORAGE_KEY,
  actaProposalFromDraft,
  actaProposalFromSubmission,
  buildActaRoundParams,
  canSubmitActaProposal,
  defaultActaPilotWorkspace,
  defaultActaProposalDraft,
  fillEmptyActaProposalDraft,
  hiddenActaProposalRows,
  parseActaPilotWorkspace,
  sealedActaProposal,
  selectActaProvider,
  serializeActaPilotWorkspace,
  type ActaPilotWorkspace,
  type ActaProposalDraft,
  type ActaProposalRecord,
} from "../lib/actaPilot";
import {
  isRevealAlreadyOpen,
  isRevealStillOpen,
  isSubmissionAlreadyRevealed,
  isTxBadSeqError,
} from "../lib/pilotConcurrency";
import { pilotRevealAction } from "../lib/pilotReveal";
import { decodePilotSubmission } from "../lib/pilotSubmission";
import { ConfettiBurst } from "../ui/Confetti";
import { useToast } from "../ui/Toast";

interface ActaPilotPageProps {
  goHome: () => void;
}

type SignableTransaction<T> = { signAndSend: () => Promise<T> };

function short(value: string | null | undefined, size = 7): string {
  if (!value) return "Not available";
  return value.length > size * 2 + 3
    ? `${value.slice(0, size)}...${value.slice(-size)}`
    : value;
}

function transactionHash(result: unknown): string | null {
  const hash = (result as { sendTransactionResponse?: { hash?: unknown } })
    .sendTransactionResponse?.hash;
  return typeof hash === "string" && hash ? hash : null;
}

function loadWorkspace(): ActaPilotWorkspace {
  const fallback = defaultActaPilotWorkspace();
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(ACTA_PILOT_STORAGE_KEY);
    const restored = raw ? parseActaPilotWorkspace(raw) : fallback;
    const roundId = actaPilotRoundIdFromHash();
    return roundId
      ? { ...restored, mode: "live", roundId, roundInput: roundId }
      : restored;
  } catch {
    return fallback;
  }
}

function statusLabel(reference: ActaEligibilityReference | null): string {
  if (!reference) return "Not checked";
  if (reference.state === "eligible") return "Eligible";
  if (reference.state === "not_eligible") return "Not eligible";
  if (reference.state === "configuration_required") return "Configuration required";
  return "Verification failed";
}

function ProposalCard({
  proposal,
  selected,
  onSelect,
}: {
  proposal: ActaProposalRecord;
  selected: boolean;
  onSelect: (wallet: string) => void;
}) {
  return (
    <article className={`pilot-result acta-proposal ${selected ? "selected" : ""}`}>
      <div className="pilot-result-heading">
        <span>{proposal.revealed ? proposal.providerName : "Sealed participant"}</span>
        <strong className={proposal.valid ? "valid" : "invalid"}>
          {selected ? "Selected" : proposal.revealed ? "Revealed" : "Sealed"}
        </strong>
      </div>
      <dl className="pilot-facts">
        {hiddenActaProposalRows(proposal).map(([label, value]) => (
          <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
        ))}
      </dl>
      {proposal.revealed && proposal.wallet && (
        <div className="pilot-actions acta-actions">
          <button
            type="button"
            className={selected ? "secondary-action compact" : "primary-action compact"}
            onClick={() => onSelect(proposal.wallet!)}
            disabled={!proposal.valid}
          >
            <UserCheck size={15} /> {selected ? "Selected provider" : "Select provider"}
          </button>
        </div>
      )}
    </article>
  );
}

export function ActaPilotPage({ goHome }: ActaPilotPageProps) {
  const toast = useToast();
  const [workspace, setWorkspace] = useState(loadWorkspace);
  const [address, setAddress] = useState<string | null>(null);
  const configuredApiKey = import.meta.env.VITE_ACTA_API_KEY?.trim() ?? "";
  const [apiKey, setApiKey] = useState(configuredApiKey);
  const [round, setRound] = useState<RoundV2 | null>(null);
  const [liveProposals, setLiveProposals] = useState<ActaProposalRecord[]>([]);
  const [receipt, setReceipt] = useState<CoreV2Receipt | null>(null);
  const [receiptVerified, setReceiptVerified] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [submissionConfirmed, setSubmissionConfirmed] = useState(false);
  const submissionFeedbackTimer = useRef<number | null>(null);
  const [revealCelebration, setRevealCelebration] = useState(0);
  const [now, setNow] = useState(Date.now());
  const contract = useWalletContract(address);
  const reader = useReadOnlyContract();
  const sdk = useReadOnlySdk();
  const drandCountdown = useDrandCountdown(round ? Number(round.reveal_round) : 0);

  const proposals = workspace.mode === "live" ? liveProposals : workspace.demoProposals;
  const revealedCount = proposals.filter((proposal) => proposal.revealed).length;
  const validRevealed = proposals.filter((proposal) => proposal.revealed && proposal.valid);
  const deadlinePassed = workspace.deadlineAt > 0 && now >= workspace.deadlineAt;
  const revealAction = pilotRevealAction(
    round?.status.tag ?? "Open",
    drandCountdown.published,
    drandCountdown.secondsRemaining,
    proposals.length > 0 && revealedCount === proposals.length,
  );
  const isOrganizer = Boolean(address && workspace.organizerWallet === address);
  const canSubmit = workspace.mode === "demo"
    ? workspace.eligibility?.state === "eligible"
    : canSubmitActaProposal({ eligibility: workspace.eligibility, connectedWallet: address });
  const selectedProposal = proposals.find(
    (proposal) => proposal.wallet === workspace.selectedProviderWallet,
  ) ?? null;

  useEffect(() => {
    window.localStorage.setItem(ACTA_PILOT_STORAGE_KEY, serializeActaPilotWorkspace(workspace));
  }, [workspace]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => () => {
    if (submissionFeedbackTimer.current !== null) {
      window.clearTimeout(submissionFeedbackTimer.current);
    }
  }, []);

  useEffect(() => {
    void isConnected().then((connected) => {
      if (!connected.isConnected) return;
      void requestAccess().then(async (access) => {
        if (access.error) return;
        const nextAddress = await resolveFreighterAddress(access);
        setAddress(nextAddress);
      });
    });
  }, []);

  useEffect(() => {
    if (workspace.mode !== "live" || !workspace.roundId || !reader) return;
    void refreshLive(workspace.roundId).catch(() => null);
    const timer = window.setInterval(() => {
      void refreshLive(workspace.roundId!).catch(() => null);
    }, 8_000);
    return () => window.clearInterval(timer);
  }, [workspace.mode, workspace.roundId, reader]);

  useEffect(() => {
    if (!address || workspace.credentialOwner) return;
    setWorkspace((current) => ({ ...current, credentialOwner: address }));
  }, [address, workspace.credentialOwner]);

  const actaBaseUrl = import.meta.env.VITE_ACTA_BASE_URL ?? ACTA_TESTNET_BASE_URL;
  const evidenceKind = workspace.mode === "live" ? "REAL" : "DEMO";
  const selectedValidReveal = Boolean(
    selectedProposal?.revealed && selectedProposal.valid && selectedProposal.wallet,
  );
  const flowSteps = [
    { label: "ACTA eligibility", done: workspace.eligibility?.state === "eligible" },
    { label: "Sealed proposal", done: proposals.length > 0 },
    { label: "Reveal", done: revealedCount > 0 && revealedCount === proposals.length },
    { label: "Application outcome", done: Boolean(workspace.selectedProviderWallet) },
    { label: "ACTA outcome", done: Boolean(workspace.outcomeCredential) },
  ];

  function addHash(hash: string | null) {
    if (!hash) return;
    setWorkspace((current) => ({
      ...current,
      transactionHashes: Array.from(new Set([...current.transactionHashes, hash])),
    }));
  }

  async function connect() {
    setBusy("connect");
    try {
      const access = await requestAccess();
      const accessError = freighterError(access);
      if (accessError) throw new Error(accessError);
      const nextAddress = await resolveFreighterAddress(access);
      const network = await getNetworkDetails();
      const networkError = freighterError(network);
      if (networkError) throw new Error(networkError);
      setAddress(nextAddress);
      setWorkspace((current) => ({
        ...current,
        credentialOwner: current.credentialOwner || nextAddress,
      }));
      toast.push("success", "Wallet connected", short(nextAddress));
    } catch (error) {
      toast.push("error", "Wallet connection failed", displayError(error));
    } finally {
      setBusy(null);
    }
  }

  async function signAndSendWithSequenceRetry<T>(
    build: () => Promise<SignableTransaction<T>>,
  ): Promise<T> {
    try {
      return await (await build()).signAndSend();
    } catch (error) {
      if (!isTxBadSeqError(error)) throw error;
      await new Promise((resolve) => window.setTimeout(resolve, 1_200));
      return (await build()).signAndSend();
    }
  }

  async function refreshLive(target = workspace.roundId ?? workspace.roundInput) {
    if (!reader || !target || !/^\d+$/.test(target)) return null;
    const roundId = BigInt(target);
    const nextRound = (await reader.get_round_v2({ round_id: roundId })).result.unwrap();
    const bidders = (await reader.get_bidders_v2({ round_id: roundId })).result.unwrap();
    const nextProposals: ActaProposalRecord[] = [];
    for (const bidder of bidders) {
      const submission = (await reader.get_submission_v2({ round_id: roundId, bidder })).result.unwrap();
      if (submission.revealed_envelope == null) {
        nextProposals.push(sealedActaProposal(bidder));
      } else {
        nextProposals.push(actaProposalFromSubmission(decodePilotSubmission(
          bidder,
          "ReceiptOnly",
          new Uint8Array(submission.revealed_envelope),
          submission.valid,
        )));
      }
    }
    setRound(nextRound);
    setLiveProposals(nextProposals);
    setWorkspace((current) => ({
      ...current,
      roundId: target,
      roundInput: target,
      organizerWallet: nextRound.operator,
      deadlineAt: Number(nextRound.commit_deadline) * 1_000,
    }));
    return nextRound;
  }

  async function verifyEligibility() {
    if (workspace.mode === "demo") {
      const demo: ActaEligibilityReference = {
        state: "eligible",
        owner: "DEMO_PARTICIPANT",
        credentialId: "DEMO_CREDENTIAL_REFERENCE",
        credentialType: workspace.policy.credentialType,
        issuerDid: null,
        subjectDid: "DEMO_SUBJECT",
        status: "valid",
        checkedAt: new Date().toISOString(),
        message: "Demo credential accepted by the local demo policy.",
        source: "demo",
      };
      setWorkspace((current) => ({
        ...current,
        eligibility: demo,
        proposalDraft: fillEmptyActaProposalDraft(current.proposalDraft),
      }));
      toast.push("success", "Demo eligibility granted", "No ACTA API or credential was used.");
      return;
    }
    if (!apiKey.trim()) {
      toast.push("error", "ACTA configuration required", "Enter the holder-bound ACTA API key. It remains in memory only.");
      return;
    }
    if (!isValidActaIssuerDid(workspace.policy.trustedIssuerDid, "testnet")) {
      toast.push("error", "Trusted issuer required", "Enter the approved issuer's real testnet did:stellar identifier.");
      return;
    }
    if (!workspace.credentialOwner || workspace.credentialOwner !== address) {
      toast.push("error", "Credential owner mismatch", "Connect the wallet that owns the ACTA credential vault.");
      return;
    }
    setBusy("verify");
    try {
      const result = await new ActaAdapter({ apiKey, baseUrl: actaBaseUrl }).verifyEligibility({
        policy: workspace.policy,
        owner: workspace.credentialOwner,
        credentialId: workspace.credentialId,
      });
      setWorkspace((current) => ({
        ...current,
        eligibility: result,
        proposalDraft: result.state === "eligible"
          ? fillEmptyActaProposalDraft(current.proposalDraft)
          : current.proposalDraft,
      }));
      toast.push(result.state === "eligible" ? "success" : "error", statusLabel(result), result.message);
    } catch (error) {
      setWorkspace((current) => ({
        ...current,
        eligibility: {
          state: "verification_failed",
          owner: current.credentialOwner,
          credentialId: current.credentialId,
          credentialType: current.policy.credentialType,
          issuerDid: null,
          subjectDid: null,
          status: null,
          checkedAt: new Date().toISOString(),
          message: displayError(error),
          source: "real",
        },
      }));
      toast.push("error", "ACTA verification failed", displayError(error));
    } finally {
      setBusy(null);
    }
  }

  async function createRound() {
    if (!contract || !address) {
      toast.push("error", "Organizer wallet required", "Connect the organizer wallet first.");
      return;
    }
    setBusy("create");
    try {
      const drand = quicknet();
      const revealRound = await roundInSeconds(drand, 135);
      const info = await drand.chain().info();
      const revealAt = drandRoundTime(revealRound, info);
      const params = buildActaRoundParams({
        operator: address,
        itemRef: await sha256Bytes(`${workspace.title}:${address}:${Date.now()}`),
        revealRound,
        commitDeadline: revealAt - 10,
        revealDeadline: revealAt + 300,
        auditorPubkey: generateAuditorKeypair().publicKey,
      });
      const sent = await signAndSendWithSequenceRetry(() => contract.create_round_v2({
        operator: address,
        item_ref: Buffer.from(params.itemRef),
        schema_ref: Buffer.from(params.schemaRef),
        reveal_round: BigInt(params.revealRound),
        clearing_rule: { tag: "LowestBid", values: undefined },
        commit_deadline: BigInt(params.commitDeadline),
        reveal_deadline: BigInt(params.revealDeadline),
        auditor_pubkey: Buffer.from(params.auditorPubkey),
        max_participants: params.maxParticipants ?? 25,
        settlement: {
          mode: { tag: "ReceiptOnly", values: undefined },
          payment_asset: undefined,
          lot_asset: undefined,
          lot_amount: 0n,
        },
      }));
      const nextId = sent.result.unwrap().toString();
      addHash(transactionHash(sent));
      setWorkspace((current) => ({
        ...current,
        mode: "live",
        roundId: nextId,
        roundInput: nextId,
        organizerWallet: address,
        deadlineAt: (revealAt - 10) * 1_000,
        selectedProviderWallet: null,
        selectedProviderName: null,
        outcomeCredential: null,
      }));
      window.location.hash = `#/pilot/acta/${nextId}`;
      toast.push("success", "ReceiptOnly round created", `Sub Rosa round #${nextId}`);
      void refreshLive(nextId);
    } catch (error) {
      toast.push("error", "Round creation failed", displayError(error));
    } finally {
      setBusy(null);
    }
  }

  async function loadRound() {
    if (!/^\d+$/.test(workspace.roundInput.trim())) {
      toast.push("error", "Round ID required", "Enter a numeric Sub Rosa round ID.");
      return;
    }
    setBusy("load");
    try {
      await refreshLive(workspace.roundInput.trim());
      setWorkspace((current) => ({ ...current, mode: "live" }));
      window.location.hash = `#/pilot/acta/${workspace.roundInput.trim()}`;
      toast.push("success", "Round loaded", `ReceiptOnly round #${workspace.roundInput.trim()}`);
    } catch (error) {
      toast.push("error", "Round load failed", displayError(error));
    } finally {
      setBusy(null);
    }
  }

  async function submitProposal() {
    if (!canSubmit) {
      toast.push("error", "Eligibility required", "Verify the required ACTA credential before submitting.");
      return;
    }
    setBusy("submit");
    try {
      const prepared = actaProposalFromDraft(workspace.proposalDraft);
      if (workspace.mode === "demo") {
        const proposal: ActaProposalRecord = {
          id: "demo-proposal",
          wallet: "DEMO_PARTICIPANT",
          ...prepared.record,
          revealed: false,
          valid: true,
          source: "demo",
        };
        setWorkspace((current) => ({ ...current, demoProposals: [proposal] }));
        showSubmissionConfirmation();
        toast.push("success", "Demo proposal sealed", "Local demo state only; no Stellar transaction was created.");
        return;
      }
      if (!contract || !address || !round || !workspace.roundId) {
        throw new Error("Connect the eligible participant wallet and load the live round.");
      }
      if (round.status.tag !== "Open") throw new Error("The commit window is closed.");
      const sealed = await sealProposal({
        round: Number(round.reveal_round),
        drand: quicknet(),
        price: prepared.price,
        proposal: prepared.proposal,
        identity: new TextEncoder().encode(address),
        auditorPublicKey: new Uint8Array(round.auditor_pubkey),
      });
      const sent = await signAndSendWithSequenceRetry(() => contract.commit_v2({
        round_id: BigInt(workspace.roundId!),
        bidder: address,
        commitment: Buffer.from(sealed.commitment),
        ciphertext: Buffer.from(sealed.ciphertext),
        escrow: 0n,
        auditor_blob: Buffer.from(sealed.auditorBlob),
      }));
      addHash(transactionHash(sent));
      await refreshLive();
      showSubmissionConfirmation();
      toast.push("success", "Sealed proposal submitted", "Proposal contents remain private until reveal.");
    } catch (error) {
      toast.push("error", "Submission failed", displayError(error));
    } finally {
      setBusy(null);
    }
  }

  function showSubmissionConfirmation() {
    if (submissionFeedbackTimer.current !== null) {
      window.clearTimeout(submissionFeedbackTimer.current);
    }
    setSubmissionConfirmed(true);
    submissionFeedbackTimer.current = window.setTimeout(() => {
      setSubmissionConfirmed(false);
      submissionFeedbackTimer.current = null;
    }, 2_200);
  }

  async function revealProposals() {
    if (workspace.mode === "demo") {
      if (!deadlinePassed) {
        toast.push("error", "Deadline not reached", "Use Simulate deadline, then reveal the demo proposal.");
        return;
      }
      setWorkspace((current) => ({
        ...current,
        demoProposals: current.demoProposals.map((proposal) => ({ ...proposal, revealed: true })),
      }));
      setRevealCelebration((current) => current + 1);
      toast.push("success", "Demo proposal revealed", "No ACTA or Stellar proof is claimed.");
      return;
    }
    if (!contract || !round || !workspace.roundId) return;
    if (round.status.tag === "Open" && !drandCountdown.published) return;
    setBusy("reveal");
    try {
      const roundId = BigInt(workspace.roundId);
      let current = (await contract.get_round_v2({ round_id: roundId })).result.unwrap();
      if (current.status.tag === "Open") {
        const signature = await fetchRoundSignature(quicknet(), Number(current.reveal_round));
        try {
          const opened = await signAndSendWithSequenceRetry(() => contract.open_reveal_v2({
            round_id: roundId,
            drand_signature: Buffer.from(signature),
          }));
          addHash(transactionHash(opened));
        } catch (error) {
          if (!isRevealAlreadyOpen(error)) throw error;
        }
        current = (await contract.get_round_v2({ round_id: roundId })).result.unwrap();
      }
      const bidders = (await contract.get_bidders_v2({ round_id: roundId })).result.unwrap();
      for (const bidder of bidders) {
        const state = (await contract.get_submission_v2({ round_id: roundId, bidder })).result.unwrap();
        if (state.revealed_envelope != null) continue;
        const seal = (await contract.get_seal_v2({ round_id: roundId, bidder })).result;
        if (!seal) throw new Error(`Encrypted submission unavailable for ${short(bidder)}.`);
        const envelope = await openPayload(new Uint8Array(seal.ciphertext), quicknet());
        try {
          const revealed = await signAndSendWithSequenceRetry(() => contract.reveal_v2({
            round_id: roundId,
            bidder,
            envelope: Buffer.from(encodePayloadEnvelope(envelope)),
          }));
          addHash(transactionHash(revealed));
        } catch (error) {
          if (!isSubmissionAlreadyRevealed(error)) throw error;
        }
      }
      await refreshLive();
      current = (await contract.get_round_v2({ round_id: roundId })).result.unwrap();
      const revealDeadlinePassed = Math.floor(Date.now() / 1_000) > Number(current.reveal_deadline);
      if (current.status.tag === "Revealing" && revealDeadlinePassed) {
        try {
          const cleared = await signAndSendWithSequenceRetry(() => contract.clear_v2({ round_id: roundId }));
          addHash(transactionHash(cleared));
        } catch (error) {
          if (!isRevealStillOpen(error)) throw error;
        }
      }
      await refreshLive();
      setRevealCelebration((value) => value + 1);
      toast.push("success", "Submissions revealed", `${bidders.length} participant(s) processed.`);
    } catch (error) {
      await refreshLive().catch(() => null);
      toast.push("error", "Reveal failed", displayError(error));
    } finally {
      setBusy(null);
    }
  }

  function selectProvider(wallet: string) {
    try {
      const selected = selectActaProvider(proposals, wallet);
      setWorkspace((current) => ({
        ...current,
        selectedProviderWallet: selected.wallet,
        selectedProviderName: selected.name,
        outcomeCredential: null,
      }));
      toast.push("success", "Provider selected by organizer", selected.name);
    } catch (error) {
      toast.push("error", "Selection failed", displayError(error));
    }
  }

  async function issueOutcome(outcomeType: ActaOutcomeType) {
    if (workspace.mode !== "live") {
      toast.push("error", "Real ACTA issuance unavailable in demo", "Switch to Live and use real ACTA configuration.");
      return;
    }
    if (!apiKey.trim()) {
      toast.push("error", "ACTA configuration required", "Enter the selected holder's ACTA API key. It remains in memory only.");
      return;
    }
    if (!address || !isOrganizer) {
      toast.push("error", "Organizer wallet required", "Connect the round organizer wallet to sign issuance.");
      return;
    }
    if (!workspace.roundId || !selectedProposal?.wallet || !workspace.eligibility?.subjectDid) {
      toast.push("error", "Verified outcome required", "Select a valid revealed participant with an ACTA subject reference first.");
      return;
    }
    if (workspace.eligibility.owner !== selectedProposal.wallet) {
      toast.push("error", "Eligibility reference mismatch", "The selected wallet must match the verified ACTA credential owner.");
      return;
    }
    setBusy("issue");
    try {
      const signer = async (xdr: string, options: { networkPassphrase: string }) => {
        const signed = await freighterSignTransaction(xdr, {
          networkPassphrase: options.networkPassphrase,
          address,
        });
        const error = freighterError(signed);
        if (error) throw new Error(error);
        if (!signed.signedTxXdr) throw new Error("Freighter returned no signed ACTA transaction.");
        return signed.signedTxXdr;
      };
      const outcome = await new ActaAdapter({ apiKey, baseUrl: actaBaseUrl }).issueOutcomeCredential({
        outcomeType,
        owner: selectedProposal.wallet,
        issuer: address,
        signTransaction: signer,
        evidence: {
          roundId: workspace.roundId,
          network: "testnet",
          subjectWallet: selectedProposal.wallet,
          subjectDid: workspace.eligibility.subjectDid,
          validReveal: selectedValidReveal,
          selectedProviderWallet: workspace.selectedProviderWallet,
        },
      });
      setWorkspace((current) => ({ ...current, outcomeCredential: outcome }));
      toast.push("success", outcome.replayed ? "ACTA credential already exists" : "ACTA outcome credential issued", outcome.credentialId);
    } catch (error) {
      toast.push("error", "ACTA issuance failed", displayError(error));
    } finally {
      setBusy(null);
    }
  }

  async function verifyReceipt() {
    if (!sdk || !workspace.roundId || workspace.mode !== "live") return;
    setBusy("receipt");
    try {
      const nextReceipt = await sdk.exportReceiptV2(BigInt(workspace.roundId));
      const result = verifyReceiptV2(nextReceipt);
      setReceipt(nextReceipt);
      setReceiptVerified(result.valid);
      toast.push(result.valid ? "success" : "error", result.valid ? "Receipt verified" : "Receipt invalid", `Sub Rosa round #${workspace.roundId}`);
    } catch (error) {
      toast.push("error", "Receipt unavailable", displayError(error));
    } finally {
      setBusy(null);
    }
  }

  function switchMode(mode: ActaPilotWorkspace["mode"]) {
    setWorkspace((current) => ({
      ...defaultActaPilotWorkspace(),
      mode,
      view: current.view,
      policy: current.policy,
      credentialLabel: current.credentialLabel,
    }));
    setRound(null);
    setLiveProposals([]);
    setReceipt(null);
    setReceiptVerified(null);
    setApiKey("");
    window.location.hash = "#/pilot/acta";
  }

  function updateDraft(key: keyof ActaProposalDraft, value: string) {
    setWorkspace((current) => ({
      ...current,
      proposalDraft: { ...current.proposalDraft, [key]: value },
    }));
  }

  return (
    <main className="pilot-page acta-pilot-page">
      <ConfettiBurst fire={revealCelebration} count={24} />
      <nav className="pilot-nav">
        <button type="button" className="brand-link" onClick={goHome}>
          <img src="/sub-rosa-logo.png" alt="Sub Rosa" />
          <span>SUB ROSA</span>
        </button>
        <div className="pilot-nav-actions">
          <div className="pilot-template-switch" role="tablist" aria-label="Evidence mode">
            <button type="button" className={workspace.mode === "demo" ? "active" : ""} onClick={() => switchMode("demo")}>Demo</button>
            <button type="button" className={workspace.mode === "live" ? "active" : ""} onClick={() => switchMode("live")}>Live</button>
          </div>
          <a href="#/docs" className="secondary-action compact">Docs</a>
          <button type="button" className="secondary-action compact" onClick={connect} disabled={busy !== null}>
            {address ? short(address) : busy === "connect" ? "Connecting..." : "Connect wallet"}
          </button>
        </div>
      </nav>

      <header className="pilot-header acta-hero">
        <div>
          <span className="pilot-kicker"><BadgeCheck size={15} /> Credential-gated private submissions</span>
          <h1>ACTA x Sub Rosa</h1>
          <p>Prove eligibility before the private round. Credentialize the verified outcome after it.</p>
          <div className="acta-trust-note">
            ACTA attests a statement produced by the underlying workflow; it is not the oracle that determines whether the business event happened.
          </div>
        </div>
        <img className="acta-mark" src="/pilots/acta/ACTA.jpg" alt="ACTA" />
      </header>

      <section className="signal-pilot-flow acta-flow" aria-label="ACTA and Sub Rosa workflow">
        {flowSteps.map((step, index) => (
          <div className={step.done ? "done" : ""} key={step.label}>
            <span>{step.done ? <CheckCircle2 size={15} /> : index + 1}</span>
            <strong>{step.label}</strong>
            {index < flowSteps.length - 1 && <ArrowRight size={15} aria-hidden="true" />}
          </div>
        ))}
      </section>

      <div className="acta-view-tabs pilot-template-switch" role="tablist" aria-label="Workspace role">
        {(["organizer", "participant", "evidence"] as const).map((view) => (
          <button type="button" key={view} className={workspace.view === view ? "active" : ""} onClick={() => setWorkspace((current) => ({ ...current, view }))}>
            {view === "organizer" ? "Organizer" : view === "participant" ? "Participant" : "Evidence"}
          </button>
        ))}
      </div>

      {workspace.mode === "live" && !apiKey && (
        <div className="pilot-alert acta-config-alert">
          ACTA configuration required for credential reads and issuance. Enter a runtime key or set VITE_ACTA_API_KEY in .env.local for this pilot.
        </div>
      )}

      <section className="pilot-layout acta-layout">
        <div className="pilot-panel acta-primary">
          <div className="pilot-panel-heading">
            <div>
              <span>{workspace.mode === "live" ? `${NETWORK_LABEL} / ACTA Testnet` : "Clearly labeled local demo"}</span>
              <h2>{workspace.title}</h2>
            </div>
            <span className={`signal-demo-badge ${workspace.mode === "live" ? "real" : ""}`}>{evidenceKind}</span>
          </div>

          {workspace.view === "organizer" && (
            <div className="acta-content">
              <section className="pilot-result">
                <div className="pilot-result-heading"><span>Eligibility policy</span><strong>Application-level gate</strong></div>
                <div className="acta-form">
                  <label>Round title<input value={workspace.title} onChange={(event) => setWorkspace((current) => ({ ...current, title: event.target.value }))} /></label>
                  <label>Credential label<input value={workspace.credentialLabel} onChange={(event) => setWorkspace((current) => ({ ...current, credentialLabel: event.target.value }))} /></label>
                  <label>ACTA credential type<input value={workspace.policy.credentialType} onChange={(event) => setWorkspace((current) => ({ ...current, policy: { ...current.policy, credentialType: event.target.value }, eligibility: null }))} /></label>
                  <label>Trusted issuer did:stellar<input placeholder="did:stellar:testnet:sd2tszkfg2t7on3clzr3zqlhea" value={workspace.policy.trustedIssuerDid} onChange={(event) => setWorkspace((current) => ({ ...current, policy: { ...current.policy, trustedIssuerDid: event.target.value.trim() }, eligibility: null }))} /></label>
                  {workspace.mode === "live" && <label>Existing round ID<input inputMode="numeric" value={workspace.roundInput} onChange={(event) => setWorkspace((current) => ({ ...current, roundInput: event.target.value }))} /></label>}
                </div>
                <p className="acta-copy">The pilot checks the real ACTA status, required W3C credential type, and exact approved issuer DID before enabling Sub Rosa commit. The current contract does not enforce ACTA authorization.</p>
                <div className="pilot-actions acta-actions">
                  {workspace.mode === "live" ? (
                    <>
                      <button type="button" className="primary-action compact" onClick={createRound} disabled={busy !== null}><ShieldCheck size={15} />{busy === "create" ? "Creating..." : "Create ReceiptOnly round"}</button>
                      <button type="button" className="secondary-action compact" onClick={loadRound} disabled={busy !== null || !workspace.roundInput}><RefreshCw size={15} />Load round</button>
                    </>
                  ) : (
                    <button type="button" className="secondary-action compact" onClick={() => setWorkspace((current) => ({ ...current, deadlineAt: Date.now() - 1_000 }))}><LockKeyhole size={15} />Simulate deadline</button>
                  )}
                  {(workspace.mode === "demo" || revealAction.visible) && (
                    <button type="button" className="primary-action compact" onClick={revealProposals} disabled={busy !== null || (workspace.mode === "live" && !revealAction.ready)}><Sparkles size={15} />{busy === "reveal" ? "Revealing..." : workspace.mode === "live" ? revealAction.label : "Reveal proposals"}</button>
                  )}
                </div>
              </section>

              <section className="pilot-result">
                <div className="pilot-result-heading"><span>Revealed proposals</span><strong>{revealedCount}/{proposals.length}</strong></div>
                {proposals.length === 0 ? <div className="pilot-empty">No sealed submissions yet.</div> : (
                  <div className="acta-proposal-grid">
                    {proposals.map((proposal) => <ProposalCard key={proposal.id} proposal={proposal} selected={proposal.wallet === workspace.selectedProviderWallet} onSelect={selectProvider} />)}
                  </div>
                )}
              </section>

              <section className="pilot-result">
                <div className="pilot-result-heading"><span>Outcome credential</span><strong>{workspace.outcomeCredential ? "Issued" : workspace.mode === "demo" ? "Configuration required" : "Pending"}</strong></div>
                <dl className="pilot-facts">
                  <div><dt>Source event</dt><dd>{workspace.selectedProviderName ? `${workspace.selectedProviderName} selected by organizer` : "No provider selected"}</dd></div>
                  <div><dt>ACTA role</dt><dd>Credentializes the organizer-confirmed outcome</dd></div>
                  <div><dt>Issuer signer</dt><dd>{workspace.organizerWallet ? short(workspace.organizerWallet) : "Organizer wallet not recorded"}</dd></div>
                  <div><dt>Credential ID</dt><dd>{workspace.outcomeCredential?.credentialId ?? "Not issued"}</dd></div>
                </dl>
                <div className="pilot-actions acta-actions">
                  <button type="button" className="primary-action compact" onClick={() => issueOutcome("selected_provider")} disabled={busy !== null || !workspace.selectedProviderWallet}><BadgeCheck size={15} />{busy === "issue" ? "Issuing..." : "Issue selected-provider credential"}</button>
                </div>
              </section>
            </div>
          )}

          {workspace.view === "participant" && (
            <div className="acta-content">
              <section className="pilot-result">
                <div className="pilot-result-heading"><span>ACTA eligibility</span><strong>{statusLabel(workspace.eligibility)}</strong></div>
                <dl className="pilot-facts acta-policy-facts">
                  <div><dt>Required credential</dt><dd>{workspace.credentialLabel}</dd></div>
                  <div><dt>Credential type</dt><dd>{workspace.policy.credentialType}</dd></div>
                  <div><dt>Trusted issuer</dt><dd>{workspace.policy.trustedIssuerDid || (workspace.mode === "demo" ? "Demo policy" : "Configuration required")}</dd></div>
                  <div><dt>Enforcement</dt><dd>Pilot application before Sub Rosa commit</dd></div>
                </dl>
                {workspace.mode === "live" && (
                  <div className="acta-form">
                    <label>Credential vault owner<input value={workspace.credentialOwner} onChange={(event) => setWorkspace((current) => ({ ...current, credentialOwner: event.target.value.trim(), eligibility: null }))} /></label>
                    <label>ACTA credential ID<input value={workspace.credentialId} onChange={(event) => setWorkspace((current) => ({ ...current, credentialId: event.target.value.trim(), eligibility: null }))} /></label>
                    <label className="acta-wide">Holder-bound ACTA API key<input type="password" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} /></label>
                  </div>
                )}
                <div className="pilot-actions acta-actions">
                  <button type="button" className="primary-action compact" onClick={verifyEligibility} disabled={busy !== null}><BadgeCheck size={15} />{busy === "verify" ? "Verifying..." : workspace.mode === "live" ? "Verify ACTA credential" : "Run demo verification"}</button>
                </div>
                {workspace.eligibility && <p className={`acta-status-message ${workspace.eligibility.state}`}>{workspace.eligibility.message}</p>}
              </section>

              <section className={`pilot-result acta-proposal-entry ${submissionConfirmed ? "sealed-confirmed" : ""}`}>
                <div className="pilot-result-heading"><span>Private proposal</span><strong>{submissionConfirmed ? "Sealed" : canSubmit ? "Unlocked" : "Eligibility locked"}</strong></div>
                <div className="acta-form">
                  <label>Provider name<input value={workspace.proposalDraft.providerName} onChange={(event) => updateDraft("providerName", event.target.value)} /></label>
                  <label>Proposed price (USDC)<input inputMode="decimal" value={workspace.proposalDraft.proposedPrice} onChange={(event) => updateDraft("proposedPrice", event.target.value)} /></label>
                  <label>Delivery days<input inputMode="numeric" value={workspace.proposalDraft.deliveryDays} onChange={(event) => updateDraft("deliveryDays", event.target.value)} /></label>
                  <label>Relevant experience<textarea rows={3} value={workspace.proposalDraft.experience} onChange={(event) => updateDraft("experience", event.target.value)} /></label>
                  <label className="acta-wide">Short proposal<textarea rows={4} value={workspace.proposalDraft.proposal} onChange={(event) => updateDraft("proposal", event.target.value)} /></label>
                </div>
                <div className="pilot-actions acta-actions">
                  <button type="button" className={`primary-action compact acta-submit-action ${submissionConfirmed ? "confirmed" : ""}`} onClick={submitProposal} disabled={busy !== null || submissionConfirmed || !canSubmit || (workspace.mode === "live" && !round)}>{submissionConfirmed ? <CheckCircle2 size={15} /> : <LockKeyhole size={15} />}{busy === "submit" ? "Submitting..." : submissionConfirmed ? "Proposal sealed" : "Submit sealed proposal"}</button>
                  <button type="button" className="secondary-action compact" onClick={() => setWorkspace((current) => ({ ...current, proposalDraft: defaultActaProposalDraft() }))}><RefreshCw size={15} />Reset draft</button>
                </div>
                <p className="acta-copy">In Live mode the existing Sub Rosa SDK encrypts the proposal locally and `commit_v2` records only the sealed submission before the shared deadline.</p>
              </section>
            </div>
          )}

          {workspace.view === "evidence" && (
            <div className="acta-content acta-evidence-grid">
              <section className="pilot-result">
                <div className="pilot-result-heading"><span>ACTA eligibility</span><strong>{workspace.eligibility?.source === "real" ? "REAL" : workspace.eligibility ? "DEMO" : "CONFIGURATION REQUIRED"}</strong></div>
                <dl className="pilot-facts">
                  <div><dt>Credential type</dt><dd>{workspace.policy.credentialType}</dd></div>
                  <div><dt>Issuer</dt><dd>{workspace.eligibility?.issuerDid ?? "Not verified"}</dd></div>
                  <div><dt>Status</dt><dd>{statusLabel(workspace.eligibility)}</dd></div>
                  <div><dt>Credential contents</dt><dd>Not retained</dd></div>
                </dl>
              </section>
              <section className="pilot-result">
                <div className="pilot-result-heading"><span>Sub Rosa</span><strong>{workspace.mode === "live" ? "REAL" : "DEMO"}</strong></div>
                <dl className="pilot-facts">
                  <div><dt>Mode</dt><dd>ReceiptOnly</dd></div>
                  <div><dt>Round ID</dt><dd>{workspace.mode === "live" ? workspace.roundId ?? "Not created" : "No fake round ID"}</dd></div>
                  <div><dt>Sealed submissions</dt><dd>{proposals.length}</dd></div>
                  <div><dt>Reveal status</dt><dd>{revealedCount}/{proposals.length}</dd></div>
                  <div><dt>Receipt</dt><dd>{receipt ? (receiptVerified ? "Verified" : "Invalid") : "Not loaded"}</dd></div>
                </dl>
                {workspace.mode === "live" && <div className="pilot-actions acta-actions"><button type="button" className="secondary-action compact" onClick={verifyReceipt} disabled={busy !== null || !workspace.roundId}><FileCheck2 size={15} />Verify canonical receipt</button></div>}
              </section>
              <section className="pilot-result">
                <div className="pilot-result-heading"><span>Application outcome</span><strong>{workspace.selectedProviderWallet ? "CONFIRMED" : "PENDING"}</strong></div>
                <dl className="pilot-facts">
                  <div><dt>Selected provider</dt><dd>{workspace.selectedProviderName ?? "Not selected"}</dd></div>
                  <div><dt>Determined by</dt><dd>Organizer application logic</dd></div>
                  <div><dt>Contract winner</dt><dd>None in ReceiptOnly</dd></div>
                </dl>
              </section>
              <section className="pilot-result">
                <div className="pilot-result-heading"><span>ACTA outcome</span><strong>{workspace.outcomeCredential ? "REAL" : "CONFIGURATION REQUIRED"}</strong></div>
                <dl className="pilot-facts">
                  <div><dt>Status</dt><dd>{workspace.outcomeCredential?.status ?? "Not issued"}</dd></div>
                  <div><dt>Credential ID</dt><dd>{workspace.outcomeCredential?.credentialId ?? "No fabricated reference"}</dd></div>
                  <div><dt>ACTA transaction</dt><dd>{workspace.outcomeCredential?.txId ? short(workspace.outcomeCredential.txId, 10) : "Not available"}</dd></div>
                </dl>
              </section>
            </div>
          )}
        </div>

        <aside className="pilot-panel acta-sidebar">
          <div className="pilot-panel-heading"><div><span>Responsibility map</span><h2>Trust boundaries</h2></div><KeyRound size={20} /></div>
          <div className="acta-sidebar-content">
            <section className="pilot-result"><strong>ACTA</strong><p>Credential infrastructure, lifecycle status, issuer identity, and wallet-signed issuance.</p></section>
            <section className="pilot-result"><strong>Sub Rosa</strong><p>Sealed submissions, confidentiality before deadline, reveal, and canonical receipts.</p></section>
            <section className="pilot-result"><strong>Organizer application</strong><p>Trusted issuer policy, application gate, provider selection, and business outcome.</p></section>
            <section className="pilot-result acta-runtime">
              <div className="pilot-result-heading"><span>Runtime</span><strong>{workspace.mode === "live" ? "LIVE" : "DEMO"}</strong></div>
              <dl className="pilot-facts">
                <div><dt>Wallet</dt><dd>{short(address)}</dd></div>
                <div><dt>Organizer</dt><dd>{short(workspace.organizerWallet)}</dd></div>
                <div><dt>Contract</dt><dd>{short(CONTRACT_ID)}</dd></div>
                <div><dt>ACTA key</dt><dd>{apiKey ? (configuredApiKey && apiKey === configuredApiKey ? "Environment configured" : "Runtime configured") : "Configuration required"}</dd></div>
              </dl>
            </section>
          </div>
        </aside>

        {workspace.mode === "live" && workspace.transactionHashes.length > 0 && (
          <section className="pilot-results-panel acta-transactions">
            <div className="pilot-panel-heading"><div><span>Sub Rosa transaction evidence</span><strong>REAL TESTNET</strong></div><ExternalLink size={18} /></div>
            <div className="pilot-results"><div className="pilot-result"><dl>{workspace.transactionHashes.map((hash) => <div key={hash}><dt>Transaction</dt><dd><a href={stellarExpertTxLink(hash)} target="_blank" rel="noreferrer"><code>{short(hash, 10)}</code></a></dd></div>)}</dl></div></div>
          </section>
        )}
      </section>

      <footer className="signal-pilot-footer">
        <span><ShieldCheck size={14} />ACTA x Sub Rosa pilot</span>
        <span>Eligibility is enforced by the pilot application before submission.</span>
        <a href="https://docs.acta.build" target="_blank" rel="noreferrer">ACTA docs <ExternalLink size={13} /></a>
      </footer>
    </main>
  );
}
