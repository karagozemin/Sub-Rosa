import { drandRoundTime } from "@sub-rosa/tlock";
import { useEffect, useMemo, useRef, useState } from "react";
import { getNetworkDetails, isConnected, requestAccess } from "@stellar/freighter-api";
import {
  createSealedProposalRound,
  SEALED_PROPOSAL_SCHEMA_REF,
  sealProposal,
  serializeReceiptV2,
  verifyReceiptV2,
  type CoreV2Receipt,
  type RoundV2,
} from "@sub-rosa/sdk";
import { fetchRoundSignature, generateAuditorKeypair, openPayload, quicknet, roundInSeconds } from "@sub-rosa/tlock";
import {
  ArrowRight,
  CheckCircle2,
  Clipboard,
  ExternalLink,
  FileCheck2,
  Gauge,
  Hourglass,
  KeyRound,
  LockKeyhole,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  WalletCards,
} from "lucide-react";

import { openX402PilotRoundIdFromHash } from "../config/routing";
import { useDrandCountdown } from "../hooks/useDrandCountdown";
import {
  CONTRACT_ID,
  NETWORK_LABEL,
  STELLAR_NETWORK,
  displayError,
  freighterError,
  resolveFreighterAddress,
  sha256Bytes,
  stellarExpertTxLink,
  useReadOnlySdk,
  useWalletSdk,
} from "../lib/chain";
import {
  DEFAULT_OPENX402_REQUEST,
  FixtureOpenX402DiscoveryAdapter,
  OPENX402_DISCOVERY_LABEL,
  OPENX402_STORAGE_KEY,
  TypedOpenX402PaymentAdapter,
  decodeOpenX402OfferEnvelope,
  defaultOpenX402OfferDraft,
  defaultOpenX402Workspace,
  evaluateAndSelectOpenX402Offer,
  formatBaseUnits,
  mapOpenX402Offer,
  openX402OfferToProposal,
  parseOpenX402Workspace,
  serializeOpenX402Workspace,
  type EvaluatedOpenX402Offer,
  type OpenX402Offer,
  type OpenX402OfferDraft,
  type OpenX402PaymentHandoff,
  type OpenX402Resource,
  type PersistedOpenX402Workspace,
} from "../integrations/openx402";
import { useToast } from "../ui/Toast";

interface OpenX402PilotPageProps {
  goHome: () => void;
}

type BusyAction = "connect" | "discover" | "create" | "load" | "submit" | "reveal" | "receipt" | "handoff" | null;
type SubmitStage = "idle" | "checking" | "sealing" | "preflight" | "wallet" | "confirming" | "syncing";

const DEMO_QUOTES = ["3.20", "2.75", "2.75"];
const OPENX402_COMMIT_DURATIONS = [
  { seconds: 60, label: "1 min" },
  { seconds: 120, label: "2 min" },
  { seconds: 300, label: "5 min" },
] as const;
const REVEAL_DELAY_SECONDS = 10;
const REVEAL_WINDOW_SECONDS = 120;
const SUBMIT_STAGE_LABELS: Record<SubmitStage, string> = {
  idle: "Submit sealed offer",
  checking: "Checking round...",
  sealing: "Sealing offer...",
  preflight: "Running preflight...",
  wallet: "Approve in Freighter...",
  confirming: "Confirming on Stellar...",
  syncing: "Syncing round...",
};

function loadWorkspace(): PersistedOpenX402Workspace {
  if (typeof window === "undefined") return defaultOpenX402Workspace();
  return parseOpenX402Workspace(window.localStorage.getItem(OPENX402_STORAGE_KEY));
}

function short(value: string | null | undefined, size = 7): string {
  if (!value) return "Not available";
  return value.length <= size * 2 + 1 ? value : `${value.slice(0, size)}...${value.slice(-size)}`;
}

function formatDeadline(timestamp: number | null, now: number): string {
  if (!timestamp) return "Not scheduled";
  const remaining = Math.ceil((timestamp - now) / 1000);
  if (remaining <= 0) return "Deadline reached";
  const minutes = Math.floor(remaining / 60);
  return `${minutes}:${String(remaining % 60).padStart(2, "0")}`;
}

function waitForRpc(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function preflightMessage(result: { ok: boolean; error?: { message: string } }): void {
  if (!result.ok) throw new Error(result.error?.message ?? "Sub Rosa preflight failed");
}

function OfferCard({ offer, selected }: { offer: EvaluatedOpenX402Offer; selected: boolean }) {
  return (
    <article className={`openx402-offer ${selected ? "selected" : ""} ${offer.validation.valid ? "valid" : "invalid"}`}>
      <div className="openx402-offer-head">
        <div><span>{offer.resourceId}</span><h3>{offer.provider}</h3></div>
        <span className={`openx402-validation ${offer.validation.valid ? "valid" : "invalid"}`}>
          {offer.validation.valid ? "VALID" : offer.validation.code.replaceAll("_", " ").toUpperCase()}
        </span>
      </div>
      <dl className="pilot-facts">
        <div><dt>Competitive quote</dt><dd>{formatBaseUnits(offer.quotedAmountBaseUnits, 6, "USDC")}</dd></div>
        <div><dt>Response target</dt><dd>{offer.estimatedResponseSeconds} seconds</dd></div>
        <div><dt>Network</dt><dd>{offer.network}</dd></div>
        <div><dt>Terms</dt><dd>{offer.terms}</dd></div>
      </dl>
      {selected && <div className="openx402-selected"><CheckCircle2 size={15} /> Application-selected offer</div>}
      {!offer.validation.valid && <p>{offer.validation.message}</p>}
    </article>
  );
}

export function OpenX402PilotPage({ goHome }: OpenX402PilotPageProps) {
  const [workspace, setWorkspace] = useState(loadWorkspace);
  const [address, setAddress] = useState<string | null>(null);
  const [busy, setBusy] = useState<BusyAction>(null);
  const [roundInput, setRoundInput] = useState(openX402PilotRoundIdFromHash() || workspace.roundId || "");
  const [round, setRound] = useState<RoundV2 | null>(null);
  const [offers, setOffers] = useState<OpenX402Offer[]>(() => workspace.revealedOffers);
  const [draft, setDraft] = useState<OpenX402OfferDraft>(() => defaultOpenX402OfferDraft(workspace.resources[0]?.id ?? ""));
  const [receipt, setReceipt] = useState<CoreV2Receipt | null>(null);
  const [receiptVerified, setReceiptVerified] = useState<boolean | null>(null);
  const [handoff, setHandoff] = useState<OpenX402PaymentHandoff | null>(null);
  const [submitStage, setSubmitStage] = useState<SubmitStage>("idle");
  const [now, setNow] = useState(Date.now());
  const createGuard = useRef(false);
  const submitGuard = useRef(false);
  const selectionGuard = useRef(false);
  const handoffGuard = useRef(false);
  const initialLiveLoad = useRef(false);
  const liveReadGeneration = useRef(0);
  const toast = useToast();
  const reader = useReadOnlySdk();
  const walletSdk = useWalletSdk(address);
  const discoveryAdapter = useMemo(() => new FixtureOpenX402DiscoveryAdapter(), []);
  const paymentAdapter = useMemo(() => new TypedOpenX402PaymentAdapter(), []);
  const countdown = useDrandCountdown(Number(round?.reveal_round ?? 0n));

  useEffect(() => {
    window.localStorage.setItem(OPENX402_STORAGE_KEY, serializeOpenX402Workspace(workspace));
  }, [workspace]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    void isConnected().then(async (result) => {
      if (!result.isConnected) return;
      const access = await requestAccess();
      if (!freighterError(access)) setAddress(await resolveFreighterAddress(access));
    }).catch(() => undefined);
  }, []);

  const evaluated = useMemo(() => evaluateAndSelectOpenX402Offer({
    offers,
    resources: workspace.resources,
    maximumPaymentBaseUnits: DEFAULT_OPENX402_REQUEST.maximumPaymentBaseUnits,
  }), [offers, workspace.resources, now]);
  const selected = workspace.selectedResourceId
    ? evaluated.evaluated.find((offer) => offer.resourceId === workspace.selectedResourceId) ?? null
    : null;
  const revealedCount = workspace.mode === "demo" && !workspace.revealComplete ? 0 : offers.length;
  const offersVisible = revealedCount > 0;
  const allOffersRevealed = workspace.mode === "demo"
    ? workspace.revealComplete
    : workspace.sealedOfferCount > 0 && revealedCount === workspace.sealedOfferCount;
  const roundFinalized = workspace.mode === "demo" ? workspace.revealComplete : round?.status.tag === "Settled";
  const hasStartedRound = workspace.mode === "live" ? Boolean(workspace.roundId) : Boolean(workspace.deadlineAt);
  const liveOfferWindowOpen = Boolean(
    round?.status.tag === "Open" && now < Number(round.commit_deadline) * 1000,
  );
  const handoffStatus = handoff?.status ?? workspace.paymentHandoffStatus;
  const handoffMessage = handoff?.message ?? (handoffStatus
    ? "OpenX402 pricing interface confirmation required"
    : "No payment preparation attempted");
  const roundTimer = useMemo(() => {
    if (workspace.mode === "demo" && workspace.deadlineAt) {
      const seconds = Math.max(0, Math.ceil((workspace.deadlineAt - now) / 1000));
      return { phase: seconds > 0 ? "Offers close in" : "Demo reveal ready", value: seconds > 0 ? formatDeadline(workspace.deadlineAt, now) : "Ready" };
    }
    if (!round && workspace.deadlineAt) {
      const seconds = Math.max(0, Math.ceil((workspace.deadlineAt - now) / 1000));
      return { phase: seconds > 0 ? "Offers close in" : "Round sync", value: seconds > 0 ? formatDeadline(workspace.deadlineAt, now) : "Load round" };
    }
    if (!round) return { phase: "Round timer", value: "Not started" };
    const nowSeconds = Math.floor(now / 1000);
    if (round.status.tag === "Open" && nowSeconds < Number(round.commit_deadline)) {
      return { phase: "Offers close in", value: formatDeadline(Number(round.commit_deadline) * 1000, now) };
    }
    if (round.status.tag === "Open" && !countdown.published) {
      return { phase: "Reveal opens in", value: `${countdown.secondsRemaining}s` };
    }
    if (round.status.tag === "Open" && nowSeconds > Number(round.reveal_deadline)) {
      return { phase: "Reveal window", value: "Expired - start new round" };
    }
    if (round.status.tag === "Revealing" && nowSeconds <= Number(round.reveal_deadline)) {
      return { phase: "Finalize available in", value: formatDeadline(Number(round.reveal_deadline) * 1000, now) };
    }
    if (round.status.tag === "Settled") return { phase: "Round timer", value: "Complete" };
    return { phase: "Round timer", value: "Action ready" };
  }, [workspace.mode, workspace.deadlineAt, round, countdown.published, countdown.secondsRemaining, now]);

  async function connect() {
    setBusy("connect");
    try {
      const connected = await requestAccess();
      const error = freighterError(connected);
      if (error) throw new Error(error);
      const nextAddress = await resolveFreighterAddress(connected);
      const details = await getNetworkDetails();
      const networkError = freighterError(details);
      if (networkError) throw new Error(networkError);
      setAddress(nextAddress);
      toast.push("success", "Wallet connected", short(nextAddress));
    } catch (error) {
      toast.push("error", "Wallet connection failed", displayError(error));
    } finally {
      setBusy(null);
    }
  }

  async function discover() {
    setBusy("discover");
    try {
      const result = await discoveryAdapter.discoverResources(DEFAULT_OPENX402_REQUEST);
      setWorkspace((current) => ({ ...current, discoveryComplete: true, resources: result.resources }));
      setDraft(defaultOpenX402OfferDraft(result.resources[0]!.id));
      toast.push("success", "Sample discovery loaded", `${result.resources.length} fixture-backed providers`);
    } catch (error) {
      toast.push("error", "Discovery unavailable", displayError(error));
    } finally {
      setBusy(null);
    }
  }

  function sampleOffers(resources: OpenX402Resource[]): OpenX402Offer[] {
    return resources.map((resource, index) => mapOpenX402Offer({
      resource,
      bidder: `demo-bidder-${index + 1}`,
      decimals: DEFAULT_OPENX402_REQUEST.decimals,
      draft: {
        ...defaultOpenX402OfferDraft(resource.id),
        quotedAmount: DEMO_QUOTES[index] ?? "4.00",
        estimatedResponseSeconds: String(35 + index * 15),
        terms: `${resource.provider} will return a concise risk classification and indicator summary.`,
      },
    }));
  }

  async function createRound() {
    if (createGuard.current) return;
    createGuard.current = true;
    setBusy("create");
    try {
      if (!workspace.discoveryComplete) throw new Error("Run discovery before creating a competition");
      if (workspace.mode === "demo") {
        setOffers(sampleOffers(workspace.resources));
        setWorkspace((current) => ({
          ...current,
          roundId: null,
          deadlineAt: Date.now() + current.commitDurationSeconds * 1000,
          sealedOfferCount: current.resources.length,
          revealComplete: false,
          revealedOffers: [],
          selectedResourceId: null,
          paymentHandoffStatus: null,
        }));
        setHandoff(null);
        toast.push("success", "Sample competition created", "Offer values remain hidden in the buyer view until reveal");
        return;
      }
      if (!walletSdk || !address) throw new Error("Connect a Stellar wallet before creating a live round");
      const drand = quicknet();
      const revealRound = await roundInSeconds(
        drand,
        workspace.commitDurationSeconds + REVEAL_DELAY_SECONDS,
      );
      const info = await drand.chain().info();
      const revealAt = drandRoundTime(revealRound, info);
      const auditor = generateAuditorKeypair();
      const itemRef = await sha256Bytes(`${DEFAULT_OPENX402_REQUEST.id}:${Date.now()}`);
      const params = {
        itemRef,
        revealRound,
        commitDeadline: revealAt - REVEAL_DELAY_SECONDS,
        revealDeadline: revealAt + REVEAL_WINDOW_SECONDS,
        auditorPubkey: auditor.publicKey,
        maxParticipants: Math.min(25, Math.max(1, workspace.resources.length)),
      };
      preflightMessage(await walletSdk.preflightCreatePartnerRoundV2({
        ...params,
        mode: "ReceiptOnly",
        clearingRule: "LowestBid",
        fixedEscrow: 0n,
        schemaRef: SEALED_PROPOSAL_SCHEMA_REF,
      }));
      const roundId = await createSealedProposalRound(walletSdk, params);
      setOffers([]);
      setRoundInput(roundId.toString());
      setWorkspace((current) => ({
        ...current,
        roundId: roundId.toString(),
        deadlineAt: (revealAt - 10) * 1000,
        sealedOfferCount: 0,
        revealComplete: false,
        revealedOffers: [],
        selectedResourceId: null,
        paymentHandoffStatus: null,
        transactionHashes: Array.from(new Set([...current.transactionHashes, ...walletSdk.submittedTransactionHashes])),
      }));
      window.location.hash = `#/pilot/openx402/${roundId}`;
      toast.push("success", "Live ReceiptOnly round created", `Round #${roundId}`);
      try {
        await refreshLiveWithRetry(roundId.toString());
      } catch (readError) {
        toast.push(
          "info",
          `Round #${roundId} created`,
          `Stellar RPC is still indexing the round. Use Load round to retry. ${displayError(readError)}`,
        );
      }
    } catch (error) {
      toast.push("error", "Round creation failed", displayError(error));
    } finally {
      createGuard.current = false;
      setBusy(null);
    }
  }

  async function refreshLive(target = workspace.roundId, generation = liveReadGeneration.current) {
    if (!reader || !target) return;
    const rid = BigInt(target);
    const nextRound = await reader.getRoundV2(rid);
    if (nextRound.mode.tag !== "ReceiptOnly") throw new Error("The selected round is not ReceiptOnly");
    const bidders = await reader.getBiddersV2(rid);
    const revealed: OpenX402Offer[] = [];
    for (const bidder of bidders) {
      const state = await reader.getSubmissionV2(rid, bidder);
      if (state.revealed_envelope) {
        revealed.push(decodeOpenX402OfferEnvelope(new Uint8Array(state.revealed_envelope), bidder));
      }
    }
    if (generation !== liveReadGeneration.current) return;
    const revealComplete = bidders.length > 0 && revealed.length === bidders.length;
    setRound({ ...nextRound, bidders });
    setOffers(revealed);
    setWorkspace((current) => ({
      ...current,
      roundId: target,
      deadlineAt: Number(nextRound.commit_deadline) * 1000,
      sealedOfferCount: bidders.length,
      revealComplete,
      revealedOffers: revealComplete ? revealed : [],
    }));
  }

  async function refreshLiveWithRetry(
    target: string,
    attempts = 5,
    generation = liveReadGeneration.current,
  ) {
    let lastError: unknown;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        await refreshLive(target, generation);
        if (generation !== liveReadGeneration.current) return;
        return;
      } catch (error) {
        lastError = error;
        if (attempt < attempts - 1) await waitForRpc(700 * (attempt + 1));
      }
    }
    throw lastError;
  }

  useEffect(() => {
    const linkedRound = openX402PilotRoundIdFromHash();
    const target = linkedRound || (workspace.mode === "live" ? workspace.roundId : null);
    if (!reader || !target || initialLiveLoad.current) return;
    initialLiveLoad.current = true;
    const generation = ++liveReadGeneration.current;
    setRoundInput(target);
    setWorkspace((current) => ({ ...current, mode: "live", roundId: target }));
    void refreshLiveWithRetry(target, 5, generation).catch((error) => {
      if (generation !== liveReadGeneration.current) return;
      toast.push("error", "Saved live round could not be restored", displayError(error));
    });
  }, [reader]);

  useEffect(() => {
    if (!reader || workspace.mode !== "live" || !workspace.roundId) return;
    const target = workspace.roundId;
    const generation = liveReadGeneration.current;
    const poll = window.setInterval(() => {
      if (busy !== null || generation !== liveReadGeneration.current) return;
      void refreshLive(target, generation).catch(() => undefined);
    }, 4_000);
    return () => window.clearInterval(poll);
  }, [reader, workspace.mode, workspace.roundId, busy]);

  async function loadRound() {
    setBusy("load");
    const target = roundInput;
    const generation = ++liveReadGeneration.current;
    try {
      if (!/^\d+$/.test(target)) throw new Error("Round ID must be a whole number");
      await refreshLiveWithRetry(target, 5, generation);
      if (generation !== liveReadGeneration.current) return;
      window.location.hash = `#/pilot/openx402/${target}`;
      toast.push("success", "Live round loaded", `ReceiptOnly round #${target}`);
    } catch (error) {
      toast.push("error", "Round load failed", displayError(error));
    } finally {
      setBusy(null);
    }
  }

  async function submitOffer() {
    if (submitGuard.current) return;
    submitGuard.current = true;
    setBusy("submit");
    setSubmitStage("checking");
    try {
      const resource = workspace.resources.find((entry) => entry.id === draft.resourceId);
      if (!resource) throw new Error("Choose a discovered resource before submitting");
      const offer = mapOpenX402Offer({
        draft,
        resource,
        bidder: address ?? `demo-provider-${resource.id}`,
        decimals: DEFAULT_OPENX402_REQUEST.decimals,
      });
      if (workspace.mode === "demo") {
        setOffers((current) => [...current.filter((entry) => entry.resourceId !== offer.resourceId), offer]);
        setWorkspace((current) => ({ ...current, sealedOfferCount: Math.max(current.sealedOfferCount, 1) }));
        toast.push("success", "Sample offer sealed", "The buyer view hides its private amount and terms until reveal");
        return;
      }
      if (!walletSdk || !address || !round || !workspace.roundId) throw new Error("Connect a wallet and load a live round first");
      if (round.status.tag !== "Open") throw new Error("This round is no longer accepting offers");
      if (Date.now() >= Number(round.commit_deadline) * 1000) {
        throw new Error("The offer window for this round has closed. Create or load a fresh round before submitting.");
      }
      const bidders = await walletSdk.getBiddersV2(BigInt(workspace.roundId));
      if (bidders.includes(address)) throw new Error("This wallet already committed an offer to the round");
      setSubmitStage("sealing");
      const sealed = await sealProposal({
        round: Number(round.reveal_round),
        drand: quicknet(),
        price: BigInt(offer.quotedAmountBaseUnits),
        proposal: openX402OfferToProposal(offer),
        identity: new TextEncoder().encode(address),
        auditorPublicKey: new Uint8Array(round.auditor_pubkey),
      });
      const commit = { roundId: BigInt(workspace.roundId), sealed, escrow: 0n };
      setSubmitStage("preflight");
      preflightMessage(await walletSdk.preflightCommitV2(commit));
      setSubmitStage("wallet");
      toast.push("info", "Freighter approval required", "Approve the sealed-offer transaction in your wallet.");
      const confirmationTimer = window.setTimeout(() => setSubmitStage("confirming"), 5_000);
      try {
        await walletSdk.submitV2(commit);
      } finally {
        window.clearTimeout(confirmationTimer);
      }
      setWorkspace((current) => ({
        ...current,
        sealedOfferCount: current.sealedOfferCount + 1,
        transactionHashes: Array.from(new Set([...current.transactionHashes, ...walletSdk.submittedTransactionHashes])),
      }));
      setSubmitStage("syncing");
      try {
        await refreshLiveWithRetry(workspace.roundId, 3);
      } catch (syncError) {
        toast.push("info", "Offer committed", `Stellar RPC is still indexing the bidder list. ${displayError(syncError)}`);
      }
      toast.push("success", "Competitive offer sealed", `ReceiptOnly round #${workspace.roundId}`);
    } catch (error) {
      toast.push("error", "Offer submission failed", displayError(error));
    } finally {
      submitGuard.current = false;
      setSubmitStage("idle");
      setBusy(null);
    }
  }

  async function advanceReveal() {
    setBusy("reveal");
    try {
      if (workspace.mode === "demo") {
        const revealedOffers = offers.length === 0 ? sampleOffers(workspace.resources) : offers;
        setOffers(revealedOffers);
        setWorkspace((current) => ({
          ...current,
          sealedOfferCount: current.resources.length,
          revealComplete: true,
          revealedOffers,
        }));
        toast.push("success", "Sample offers revealed", "Application validation can now inspect the competitive quotes");
        return;
      }
      if (!walletSdk || !round || !workspace.roundId) throw new Error("Load a live round and connect a keeper wallet first");
      const rid = BigInt(workspace.roundId);
      let current = await walletSdk.getRoundV2(rid);
      let finalized = false;
      if (current.status.tag === "Open") {
        if (!countdown.published) throw new Error("Drand reveal round has not published yet");
        const signature = await fetchRoundSignature(quicknet(), Number(current.reveal_round));
        preflightMessage(await walletSdk.preflightOpenRevealV2(rid, signature));
        await walletSdk.openRevealV2(rid, signature);
        current = await walletSdk.getRoundV2(rid);
      }
      if (current.status.tag === "Revealing") {
        for (const bidder of await walletSdk.getBiddersV2(rid)) {
          const state = await walletSdk.getSubmissionV2(rid, bidder);
          if (state.revealed_envelope) continue;
          const seal = await walletSdk.getSealV2(rid, bidder);
          if (!seal) throw new Error(`Encrypted offer unavailable for ${short(bidder)}`);
          const envelope = await openPayload(new Uint8Array(seal.ciphertext), quicknet());
          const reveal = { roundId: rid, bidder, envelope };
          preflightMessage(await walletSdk.preflightRevealV2(reveal));
          await walletSdk.revealV2(reveal);
        }
        current = await walletSdk.getRoundV2(rid);
        if (Math.floor(Date.now() / 1000) > Number(current.reveal_deadline)) {
          preflightMessage(await walletSdk.preflightClearV2(rid));
          await walletSdk.clearV2(rid);
          finalized = true;
        }
      }
      setWorkspace((state) => ({
        ...state,
        transactionHashes: Array.from(new Set([...state.transactionHashes, ...walletSdk.submittedTransactionHashes])),
      }));
      await refreshLiveWithRetry(workspace.roundId);
      toast.push(
        "success",
        finalized ? "ReceiptOnly round finalized" : "Offers revealed",
        finalized
          ? "The canonical receipt is now available"
          : "Revealed quotes are now public and application selection can proceed before finalization",
      );
    } catch (error) {
      toast.push("error", "Reveal failed", displayError(error));
    } finally {
      setBusy(null);
    }
  }

  function applySelection() {
    if (selectionGuard.current) return;
    selectionGuard.current = true;
    try {
      if (!allOffersRevealed) throw new Error("Wait until every sealed offer has been revealed before selection");
      if (!evaluated.selected) throw new Error("No valid revealed offer is within the buyer allowance");
      setWorkspace((current) => ({ ...current, selectedResourceId: evaluated.selected!.resourceId }));
      setHandoff(null);
      toast.push("success", "Provider selected by application policy", evaluated.selected.provider);
    } catch (error) {
      toast.push("error", "Selection failed", displayError(error));
    } finally {
      selectionGuard.current = false;
    }
  }

  function prepareHandoff() {
    if (handoffGuard.current) return;
    handoffGuard.current = true;
    setBusy("handoff");
    try {
      if (!selected) throw new Error("Select a valid revealed offer first");
      const resource = workspace.resources.find((entry) => entry.id === selected.resourceId);
      if (!resource) throw new Error("Selected discovery resource is unavailable");
      const next = paymentAdapter.preparePayment({
        resource,
        selectedOffer: selected,
        maximumPaymentBaseUnits: DEFAULT_OPENX402_REQUEST.maximumPaymentBaseUnits,
      });
      setHandoff(next);
      setWorkspace((current) => ({ ...current, paymentHandoffStatus: next.status }));
      toast.push("success", "Payment handoff prepared", next.message);
    } catch (error) {
      toast.push("error", "Payment handoff failed", displayError(error));
    } finally {
      handoffGuard.current = false;
      setBusy(null);
    }
  }

  async function downloadReceipt() {
    if (!reader || !workspace.roundId || workspace.mode !== "live") throw new Error("A finalized live round is required");
    setBusy("receipt");
    try {
      const next = await reader.exportReceiptV2(BigInt(workspace.roundId));
      const verification = verifyReceiptV2(next);
      if (!verification.valid) throw new Error("Canonical receipt verification failed");
      setReceipt(next);
      setReceiptVerified(true);
      const url = URL.createObjectURL(new Blob([serializeReceiptV2(next)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `sub-rosa-openx402-round-${workspace.roundId}-receipt.json`;
      link.click();
      URL.revokeObjectURL(url);
      toast.push("success", "Receipt verified", `ReceiptOnly round #${workspace.roundId}`);
    } catch (error) {
      setReceiptVerified(false);
      toast.push("error", "Receipt unavailable", displayError(error));
    } finally {
      setBusy(null);
    }
  }

  async function copyLink() {
    const suffix = workspace.roundId ? `/${workspace.roundId}` : "";
    await navigator.clipboard.writeText(`${window.location.origin}${window.location.pathname}#/pilot/openx402${suffix}`);
    toast.push("success", "Workspace link copied", workspace.roundId ? `Round #${workspace.roundId}` : "OpenX402 pilot");
  }

  function switchMode(mode: "demo" | "live") {
    liveReadGeneration.current += 1;
    setWorkspace((current) => ({
      ...current,
      mode,
      roundId: null,
      deadlineAt: null,
      sealedOfferCount: 0,
      revealComplete: false,
      revealedOffers: [],
      selectedResourceId: null,
      paymentHandoffStatus: null,
    }));
    setRound(null);
    setOffers([]);
    setHandoff(null);
    setReceipt(null);
  }

  function startNewRound() {
    liveReadGeneration.current += 1;
    createGuard.current = false;
    submitGuard.current = false;
    selectionGuard.current = false;
    handoffGuard.current = false;
    initialLiveLoad.current = true;
    setBusy(null);
    setSubmitStage("idle");
    setRound(null);
    setRoundInput("");
    setOffers([]);
    setReceipt(null);
    setReceiptVerified(null);
    setHandoff(null);
    setWorkspace((current) => ({
      ...current,
      roundId: null,
      deadlineAt: null,
      sealedOfferCount: 0,
      revealComplete: false,
      revealedOffers: [],
      selectedResourceId: null,
      paymentHandoffStatus: null,
      transactionHashes: [],
    }));
    window.history.replaceState(null, "", `${window.location.pathname}#/pilot/openx402`);
    toast.push("success", "Ready for a new round", "Discovery data and wallet connection were kept.");
  }

  function resetWorkspace() {
    liveReadGeneration.current += 1;
    setWorkspace(defaultOpenX402Workspace());
    setOffers([]);
    setRound(null);
    setReceipt(null);
    setHandoff(null);
    setRoundInput("");
    window.location.hash = "#/pilot/openx402";
  }

  const flow = [
    { label: "Discover", done: workspace.discoveryComplete },
    { label: "Seal offers", done: workspace.sealedOfferCount > 0 },
    { label: "Reveal", done: allOffersRevealed },
    { label: "Select", done: Boolean(selected) },
    { label: "Pay", done: handoff?.status === "ready_for_external_execution" },
  ];
  const revealLabel = workspace.mode === "demo"
    ? "Reveal sample offers"
    : round?.status.tag === "Open" && Math.floor(now / 1000) > Number(round.reveal_deadline)
      ? "Reveal window expired"
    : round?.status.tag === "Revealing" && Math.floor(now / 1000) <= Number(round.reveal_deadline)
      ? allOffersRevealed ? "Offers visible - await finalize" : "Reveal remaining offers"
    : round?.status.tag === "Revealing"
      ? "Finalize ReceiptOnly"
      : round?.status.tag === "Settled" ? "Reveal finalized" : countdown.published ? "Open + reveal" : `Reveal in ${countdown.secondsRemaining}s`;
  const revealDisabled = busy !== null
    || (workspace.mode === "demo" && workspace.sealedOfferCount === 0)
    || (workspace.mode === "live" && (
      !round
      || round.status.tag === "Settled"
      || (round.status.tag === "Open" && Math.floor(now / 1000) > Number(round.reveal_deadline))
      || (round.status.tag === "Open" && !countdown.published)
      || (round.status.tag === "Revealing" && allOffersRevealed && Math.floor(now / 1000) <= Number(round.reveal_deadline))
    ));

  return (
    <main className="pilot-page openx402-pilot-page">
      <nav className="pilot-nav">
        <button type="button" className="brand-link" onClick={goHome}><img src="/sub-rosa-logo.png" alt="" /><span>Sub Rosa</span></button>
        <div className="pilot-nav-actions">
          <span className="pilot-network">{workspace.mode === "live" ? `${NETWORK_LABEL} · Live ReceiptOnly` : "Fixture discovery · Demo offers"}</span>
          <div className="pilot-template-switch" role="tablist" aria-label="Pilot mode">
            <button type="button" className={workspace.mode === "demo" ? "active" : ""} onClick={() => switchMode("demo")}>Demo</button>
            <button type="button" className={workspace.mode === "live" ? "active" : ""} onClick={() => switchMode("live")}>Live Sub Rosa</button>
          </div>
          <a href="#/docs" className="secondary-action compact">Docs</a>
          <button type="button" className="secondary-action compact" onClick={connect} disabled={busy !== null}>{address ? short(address) : busy === "connect" ? "Connecting..." : "Connect wallet"}</button>
        </div>
      </nav>

      <header className="pilot-header openx402-hero">
        <div>
          <span className="pilot-kicker"><Sparkles size={15} /> Sealed agent bidding pilot</span>
          <h1>OpenX402 × Sub Rosa</h1>
          <p>Lightweight sealed competition between service discovery and x402 payment, designed for low-value requests where full agent negotiation may cost more than the service.</p>
          <div className="openx402-boundary">Sub Rosa adds private competitive selection between discovery and payment without replacing either system.</div>
        </div>
        <div className="pilot-partner-identity openx402-identity">
          <img className="pilot-partner-mark" src="/pilots/openx402/openx402-logo.jpg" alt="OpenX402" />
          <div className="pilot-template-switch" role="tablist" aria-label="Workspace view">
            {(["buyer", "provider", "evidence"] as const).map((view) => <button key={view} type="button" className={workspace.view === view ? "active" : ""} onClick={() => setWorkspace((current) => ({ ...current, view }))}>{view[0]!.toUpperCase() + view.slice(1)}</button>)}
          </div>
        </div>
      </header>

      <section className="signal-pilot-flow openx402-flow" aria-label="OpenX402 pilot workflow">
        {flow.map((step, index) => <div key={step.label} className={step.done ? "done" : ""}><span>{step.done ? <CheckCircle2 size={15} /> : index + 1}</span><strong>{step.label}</strong>{index < flow.length - 1 && <ArrowRight size={15} />}</div>)}
      </section>

      <section className="pilot-layout openx402-layout">
        <div className="pilot-panel openx402-primary">
          <div className="pilot-panel-heading"><div><span>OpenX402 partner workflow</span><h2>{workspace.view === "buyer" ? "Buyer workspace" : workspace.view === "provider" ? "Provider workspace" : "Evidence workspace"}</h2></div><span className={`signal-demo-badge ${workspace.mode === "live" ? "real" : ""}`}>{workspace.mode === "live" ? "REAL SUB ROSA" : "DEMO"}</span></div>
          <div className="openx402-main">
            <section className="pilot-result openx402-request">
              <div className="pilot-result-heading"><span>Competitive service request</span><strong>{formatBaseUnits(DEFAULT_OPENX402_REQUEST.maximumPaymentBaseUnits, 6, "USDC")} maximum</strong></div>
              <h3>{DEFAULT_OPENX402_REQUEST.title}</h3><p>{DEFAULT_OPENX402_REQUEST.description}</p>
              <dl className="pilot-facts"><div><dt>Buyer policy</dt><dd>Application-level spending cap, not escrow or payment approval</dd></div><div><dt>Request privacy</dt><dd>Outside v1; Sub Rosa seals provider offers only</dd></div><div><dt>Deadline</dt><dd>{formatDeadline(workspace.deadlineAt, now)}</dd></div><div><dt>Sub Rosa mode</dt><dd>ReceiptOnly · no economic winner</dd></div></dl>
              <div className="pilot-actions"><button type="button" className="secondary-action compact" onClick={copyLink}><Clipboard size={15} />Copy link</button><button type="button" className="secondary-action compact" onClick={resetWorkspace}><RefreshCw size={15} />Reset</button></div>
            </section>

            {workspace.view === "buyer" && <>
              <section className="pilot-result">
                <div className="pilot-result-heading"><span>Discovery</span><strong className="openx402-demo-label">{OPENX402_DISCOVERY_LABEL}</strong></div>
                <p className="openx402-note">The adapter normalizes sample records into the proposed resource boundary. These are not live MCP responses or provider registrations.</p>
                <div className="pilot-actions"><button type="button" className="primary-action compact" onClick={discover} disabled={busy !== null}><Search size={15} />{busy === "discover" ? "Discovering..." : "Discover sample providers"}</button></div>
                <div className="openx402-resource-grid">{workspace.resources.map((resource) => <article key={resource.id} className="openx402-resource"><div><span>SAMPLE PROVIDER</span><h3>{resource.provider}</h3></div><dl><div><dt>Public listing</dt><dd>{resource.publicListedAmountBaseUnits ? formatBaseUnits(resource.publicListedAmountBaseUnits, 6, "USDC") : "Not provided"}</dd></div><div><dt>Network</dt><dd>{resource.network}</dd></div><div><dt>Resource binding</dt><dd><code>{short(resource.resourceDigest, 9)}</code></dd></div></dl></article>)}</div>
              </section>
              <section className="pilot-result">
                <div className="pilot-result-heading"><span>Competition operations</span><strong>{workspace.mode === "live" ? round?.status.tag ?? "No round" : workspace.revealComplete ? "Revealed" : workspace.sealedOfferCount ? "Sealed" : "Ready"}</strong></div>
                {workspace.mode === "live" && <div className="openx402-inline-form"><label>Existing round ID<input inputMode="numeric" value={roundInput} onChange={(event) => setRoundInput(event.target.value)} /></label><button type="button" className="secondary-action compact" onClick={loadRound} disabled={busy !== null || !roundInput}>Load round</button></div>}
                {!hasStartedRound && <div className="openx402-duration-picker"><span>Offer window</span><div role="radiogroup" aria-label="Offer window duration">{OPENX402_COMMIT_DURATIONS.map((duration) => <button key={duration.seconds} type="button" role="radio" aria-checked={workspace.commitDurationSeconds === duration.seconds} className={workspace.commitDurationSeconds === duration.seconds ? "active" : ""} onClick={() => setWorkspace((current) => ({ ...current, commitDurationSeconds: duration.seconds }))} disabled={busy !== null}>{duration.label}</button>)}</div><small>Providers can commit sealed offers until this window closes. Reveal opens about 10 seconds later.</small></div>}
                <div className="openx402-round-timer" aria-live="polite"><Hourglass size={18} /><div><span>{roundTimer.phase}</span><strong>{roundTimer.value}</strong></div>{workspace.roundId && <code>Round #{workspace.roundId}</code>}</div>
                <div className="pilot-actions">{hasStartedRound ? <button type="button" className="primary-action compact" onClick={startNewRound} disabled={busy !== null}><RefreshCw size={15} />Start new round</button> : <button type="button" className="primary-action compact" onClick={createRound} disabled={busy !== null || !workspace.discoveryComplete}><LockKeyhole size={15} />{busy === "create" ? "Creating..." : workspace.mode === "live" ? "Create ReceiptOnly round" : "Seal sample offers"}</button>}<button type="button" className="secondary-action compact" onClick={advanceReveal} disabled={revealDisabled}><Sparkles size={15} />{busy === "reveal" ? "Advancing..." : revealLabel}</button><button type="button" className="secondary-action compact" onClick={applySelection} disabled={busy !== null || !allOffersRevealed}><Gauge size={15} />Apply lowest valid policy</button></div>
              </section>
              <section className="pilot-result">
                <div className="pilot-result-heading"><span>Sub Rosa reveal result</span><strong>{offersVisible ? `${revealedCount} revealed / ${workspace.sealedOfferCount} sealed` : `${workspace.sealedOfferCount} sealed`}</strong></div>
                {workspace.mode === "live" && round && round.bidders.length > 0 && <div className="openx402-participants"><div><strong>Public participants</strong><span>{round.bidders.length} committed wallet{round.bidders.length === 1 ? "" : "s"}</span></div><div>{round.bidders.map((bidder, index) => <code key={bidder} title={bidder}>Offer {index + 1} · {short(bidder, 9)}</code>)}</div><p>Participation and bidder addresses are public. Quote amounts and service terms remain private until each envelope is revealed.</p></div>}
                {!offersVisible ? <div className="openx402-sealed-state"><LockKeyhole size={22} /><div><strong>Competitive values hidden</strong><p>Participation is public, but quote amounts and service terms remain private until their sealed envelopes are revealed.</p></div></div> : evaluated.evaluated.length ? <><div className="openx402-offer-grid">{evaluated.evaluated.map((offer) => <OfferCard key={`${offer.bidder}:${offer.resourceId}`} offer={offer} selected={selected?.bidder === offer.bidder} />)}</div>{!allOffersRevealed && <p className="openx402-note">Opened offers are public. Waiting for {workspace.sealedOfferCount - revealedCount} remaining sealed offer{workspace.sealedOfferCount - revealedCount === 1 ? "" : "s"} before selection.</p>}</> : <div className="pilot-empty">No revealed offers could be decoded.</div>}
              </section>
              <section className="pilot-result openx402-handoff">
                <div className="pilot-result-heading"><span>Application selection → payment</span><strong>{handoffStatus ? handoffStatus.replaceAll("_", " ").toUpperCase() : selected ? "HANDOFF READY" : "PENDING"}</strong></div>
                <dl className="pilot-facts"><div><dt>Selected provider</dt><dd>{selected?.provider ?? "Not selected"}</dd></div><div><dt>Selected by</dt><dd>Application policy, never the Sub Rosa contract</dd></div><div><dt>Payment execution</dt><dd>{handoffMessage}</dd></div><div><dt>Atomicity</dt><dd>Reveal evidence and x402 payment evidence are separate and sequential</dd></div></dl>
                <div className="pilot-actions"><button type="button" className="primary-action compact" onClick={prepareHandoff} disabled={busy !== null || !selected}><WalletCards size={15} />{busy === "handoff" ? "Preparing..." : "Prepare payment handoff"}</button></div>
                {handoffStatus && <div className="openx402-awaiting"><KeyRound size={18} /><div><strong>Payment handoff ready</strong><span>OpenX402 pricing interface confirmation required</span></div></div>}
              </section>
            </>}

            {workspace.view === "provider" && <>
              <section className="pilot-result"><div className="pilot-result-heading"><span>Public request constraints</span><strong>Provider view</strong></div><dl className="pilot-facts"><div><dt>Request</dt><dd>{DEFAULT_OPENX402_REQUEST.title}</dd></div><div><dt>Maximum allowance</dt><dd>5 USDC · application policy</dd></div><div><dt>Discovered resources</dt><dd>{workspace.resources.length}</dd></div><div><dt>Privacy</dt><dd>Your competitive offer stays private until the shared deadline</dd></div></dl></section>
              <section className="pilot-result">
                <div className="pilot-result-heading"><span>Sealed competitive offer</span><strong>{workspace.mode === "live" ? short(address) : "Demo provider"}</strong></div>
                {workspace.resources.length === 0 && <div className="openx402-provider-prerequisite"><div><strong>No discovery resources loaded</strong><span>Load the sample discovery data before choosing the provider resource this offer will bind to.</span></div><button type="button" className="secondary-action compact" onClick={discover} disabled={busy !== null}><Search size={15} />{busy === "discover" ? "Loading..." : "Load sample resources"}</button></div>}
                <div className="openx402-form">
                  <label>Discovery resource<select value={draft.resourceId} disabled={workspace.resources.length === 0} onChange={(event) => setDraft((current) => ({ ...current, resourceId: event.target.value }))}><option value="" disabled>{workspace.resources.length === 0 ? "Load discovery resources first" : "Select a provider resource"}</option>{workspace.resources.map((resource) => <option value={resource.id} key={resource.id}>{resource.provider}</option>)}</select></label>
                  <label>Quote (USDC)<input inputMode="decimal" value={draft.quotedAmount} onChange={(event) => setDraft((current) => ({ ...current, quotedAmount: event.target.value }))} /></label>
                  <label>Response time (seconds)<input inputMode="numeric" value={draft.estimatedResponseSeconds} onChange={(event) => setDraft((current) => ({ ...current, estimatedResponseSeconds: event.target.value }))} /></label>
                  <label>Valid for (minutes)<input inputMode="numeric" value={draft.validityMinutes} onChange={(event) => setDraft((current) => ({ ...current, validityMinutes: event.target.value }))} /></label>
                  <label className="wide">Service terms<textarea rows={4} value={draft.terms} onChange={(event) => setDraft((current) => ({ ...current, terms: event.target.value }))} /></label>
                </div>
                {workspace.mode === "live" && round && !liveOfferWindowOpen && <div className="openx402-provider-prerequisite"><div><strong>Offer window closed</strong><span>This round no longer accepts commits. The buyer must create a fresh round, then share its round link with providers.</span></div></div>}
                <div className="pilot-actions"><button type="button" className="primary-action compact" onClick={submitOffer} disabled={busy !== null || workspace.resources.length === 0 || (workspace.mode === "live" && (!address || !round || !liveOfferWindowOpen))}><LockKeyhole size={15} />{busy === "submit" ? SUBMIT_STAGE_LABELS[submitStage] : "Submit sealed offer"}</button></div>
                <p className="openx402-note">The selected discovery resource digest, quote, network, asset, payee, terms, and validity are commitment-bound inside the existing Sub Rosa proposal envelope.</p>
              </section>
            </>}

            {workspace.view === "evidence" && <div className="openx402-evidence-grid">
              <section className="pilot-result"><div className="pilot-result-heading"><span>Sub Rosa evidence</span><strong>{workspace.mode === "live" ? "REAL" : "DEMO"}</strong></div><dl className="pilot-facts"><div><dt>Round ID</dt><dd>{workspace.mode === "live" ? workspace.roundId ?? "Not created" : "No fabricated ID"}</dd></div><div><dt>Mode</dt><dd>ReceiptOnly</dd></div><div><dt>Sealed / revealed</dt><dd>{workspace.sealedOfferCount} / {revealedCount}</dd></div><div><dt>Round finalization</dt><dd>{roundFinalized ? "Finalized" : allOffersRevealed ? "Revealed; receipt pending" : "Pending"}</dd></div><div><dt>Protocol winner</dt><dd>None</dd></div><div><dt>Canonical receipt</dt><dd>{receipt ? receiptVerified ? "Verified" : "Invalid" : "Not exported"}</dd></div></dl>{workspace.mode === "live" && <div className="pilot-actions"><button type="button" className="secondary-action compact" onClick={downloadReceipt} disabled={busy !== null || round?.status.tag !== "Settled"}><FileCheck2 size={15} />Verify + download receipt</button></div>}</section>
              <section className="pilot-result"><div className="pilot-result-heading"><span>OpenX402 evidence</span><strong>AWAITING INTERFACE</strong></div><dl className="pilot-facts"><div><dt>Discovery source</dt><dd>{OPENX402_DISCOVERY_LABEL}</dd></div><div><dt>Selected resource</dt><dd>{selected?.resourceId ?? "Not selected"}</dd></div><div><dt>Real requirement</dt><dd>Not available</dd></div><div><dt>Payment receipt</dt><dd>Not fabricated</dd></div><div><dt>Settlement reference</dt><dd>Not available</dd></div></dl></section>
              <section className="pilot-result"><div className="pilot-result-heading"><span>Trust boundary</span><strong>SEQUENTIAL</strong></div><dl className="pilot-facts"><div><dt>OpenX402</dt><dd>Discovery, resource metadata, payment requirements, verification, settlement</dd></div><div><dt>Sub Rosa</dt><dd>Private offers, deadline, reveal, canonical receipt</dd></div><div><dt>Pilot application</dt><dd>Request, spending cap, validation, selection, handoff</dd></div></dl></section>
            </div>}
          </div>
        </div>

        <aside className="pilot-panel openx402-sidebar">
          <div className="pilot-panel-heading"><div><span>SCF evidence view</span><h2>Pilot status</h2></div><ShieldCheck size={19} /></div>
          <div className="openx402-sidebar-main">
            <dl className="pilot-facts"><div><dt>Partner workflow</dt><dd>OpenX402 × Sub Rosa pilot</dd></div><div><dt>Discovery</dt><dd>{workspace.discoveryComplete ? `${workspace.resources.length} sample providers` : "Not run"}</dd></div><div><dt>Buyer spending cap</dt><dd>5 USDC</dd></div><div><dt>Sealed offers</dt><dd>{workspace.sealedOfferCount}</dd></div><div><dt>Reveal result</dt><dd>{offersVisible ? `${revealedCount} / ${workspace.sealedOfferCount} visible` : "Private / pending"}</dd></div><div><dt>Selected provider</dt><dd>{selected?.provider ?? "Not selected"}</dd></div><div><dt>Payment handoff</dt><dd>{handoffStatus ?? "Not prepared"}</dd></div></dl>
            <div className="openx402-status-stack"><span className="status real">{workspace.mode === "live" ? "REAL SUB ROSA" : "DEMO SUB ROSA"}</span><span className="status demo">DEMO DISCOVERY DATA</span><span className="status waiting">AWAITING OPENX402 INTERFACE</span></div>
            <div className="openx402-trust"><strong>v1 scope</strong><p>No private request transport, no invented MCP response, no fake payment success, and no claim of atomic reveal plus settlement.</p></div>
          </div>
        </aside>

        {workspace.mode === "live" && workspace.transactionHashes.length > 0 && <section className="pilot-results-panel openx402-tx-panel"><div className="pilot-panel-heading"><div><span>Sub Rosa transaction evidence</span><strong>REAL {STELLAR_NETWORK.toUpperCase()}</strong></div><ExternalLink size={18} /></div><div className="pilot-results"><div className="pilot-result"><dl>{workspace.transactionHashes.map((hash) => <div key={hash}><dt>Stellar transaction</dt><dd><a href={stellarExpertTxLink(hash)} target="_blank" rel="noreferrer"><code>{short(hash, 10)}</code></a></dd></div>)}</dl></div></div></section>}
      </section>

      <footer className="signal-pilot-footer"><span><ShieldCheck size={14} />OpenX402 × Sub Rosa pilot</span><span>ReceiptOnly sealed competition · application selection · typed payment handoff</span><a href="https://docs.openx402.ai" target="_blank" rel="noreferrer">OpenX402 docs <ExternalLink size={13} /></a></footer>
    </main>
  );
}
