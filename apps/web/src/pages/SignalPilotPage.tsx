import { drandRoundTime } from "@sub-rosa/tlock";
import { Buffer } from "buffer";
import { useEffect, useRef, useState } from "react";
import {
  getNetworkDetails,
  isConnected,
  requestAccess,
} from "@stellar/freighter-api";
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
  Clipboard,
  FileCheck2,
  KeyRound,
  LockKeyhole,
  RotateCcw,
  ShieldCheck,
  UnlockKeyhole,
  Users,
  X,
} from "lucide-react";

import {
  CONTRACT_ID,
  LOGO_SRC,
  NETWORK,
  NETWORK_LABEL,
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
import { useDrandCountdown } from "../hooks/useDrandCountdown";
import { isRevealAlreadyOpen, isSubmissionAlreadyRevealed } from "../lib/pilotConcurrency";
import { decodePilotSubmission, type PilotSubmissionView } from "../lib/pilotSubmission";
import { useToast } from "../ui/Toast";
import { ConfettiBurst } from "../ui/Confetti";

type SignalDealType = "otc" | "loan";
type SignalRole = "organizer" | "provider";
type SignalStatus = "collecting" | "ready" | "revealed" | "selected";
type SignalMode = "sample" | "live";
type DealDuration = "2m" | "5m" | "1d" | "15d";

const DEAL_DURATION_OPTIONS: Array<{ value: DealDuration; label: string; seconds: number }> = [
  { value: "2m", label: "2 min", seconds: 2 * 60 },
  { value: "5m", label: "5 min", seconds: 5 * 60 },
  { value: "1d", label: "1 day", seconds: 24 * 60 * 60 },
  { value: "15d", label: "15 days", seconds: 15 * 24 * 60 * 60 },
];

const DEFAULT_DURATION_BY_TYPE: Record<SignalDealType, DealDuration> = {
  otc: "5m",
  loan: "1d",
};

interface DealDraft {
  type: SignalDealType;
  title: string;
  asset: string;
  side: "buy" | "sell";
  targetAmount: string;
  settlementWindow: string;
  notes: string;
  requestedAmount: string;
  duration: string;
  purpose: string;
}

interface OtcOffer {
  rate: string;
  amount: string;
  timeline: string;
  terms: string;
  notes: string;
}

interface LoanOffer {
  interestRate: string;
  amount: string;
  duration: string;
  collateral: string;
  terms: string;
  notes: string;
}

type SignalOfferData = OtcOffer | LoanOffer;

interface SignalOffer {
  id: string;
  provider: string;
  providerMeta: string;
  submittedAt: number;
  data: SignalOfferData;
  revealed: boolean;
  source: "sample" | "demo" | "live";
}

interface PersistedRoom {
  id: string;
  draft: DealDraft;
  createdAt: number;
  deadlineAt: number;
  status: SignalStatus;
  selectedProviderId: string | null;
  revealedAt: number | null;
  mode: "ReceiptOnly";
  roundId: string | null;
  network?: string;
  contractId?: string;
  transactionHashes?: string[];
  durationPreset?: DealDuration;
  sampleOffers?: SignalOffer[];
}

const STORAGE_KEY = "subrosa-signal-pilot-room-v1";
const ROOMS_STORAGE_KEY = "subrosa-signal-pilot-rooms-v1";
const SAMPLE_ROOM_ID = "signal-otc-demo";

const DEFAULT_OTC: DealDraft = {
  type: "otc",
  title: "Buy 100,000 USDC worth of XLM",
  asset: "XLM",
  side: "buy",
  targetAmount: "100,000 USDC",
  settlementWindow: "T+1",
  notes: "Competitive OTC quote for a treasury rebalance. Best executable terms win.",
  requestedAmount: "",
  duration: "",
  purpose: "",
};

const DEFAULT_LOAN: DealDraft = {
  type: "loan",
  title: "30-day XLM working capital facility",
  asset: "USDC",
  side: "buy",
  targetAmount: "250,000 USDC",
  settlementWindow: "Within 24 hours",
  notes: "Short-duration facility for market-making inventory.",
  requestedAmount: "250,000 USDC",
  duration: "30 days",
  purpose: "Working capital for market-making inventory",
};

const SAMPLE_OTC_OFFERS: SignalOffer[] = [
  {
    id: "provider-a",
    provider: "Northstar Markets",
    providerMeta: "Institutional desk",
    submittedAt: 0,
    source: "sample",
    revealed: false,
    data: {
      rate: "0.00001342 USDC / XLM",
      amount: "100,000 USDC",
      timeline: "T+1, same-day confirmation",
      terms: "Firm quote for 15 minutes",
      notes: "Settlement through the organizer's nominated venue.",
    },
  },
  {
    id: "provider-b",
    provider: "Cedar OTC",
    providerMeta: "Digital asset liquidity",
    submittedAt: 0,
    source: "sample",
    revealed: false,
    data: {
      rate: "0.00001351 USDC / XLM",
      amount: "100,000 USDC",
      timeline: "T+1, settlement-ready",
      terms: "Quote valid until deadline + 30 minutes",
      notes: "No minimum ticket adjustment required.",
    },
  },
  {
    id: "provider-c",
    provider: "Harbor Prime",
    providerMeta: "Principal liquidity",
    submittedAt: 0,
    source: "sample",
    revealed: false,
    data: {
      rate: "0.00001347 USDC / XLM",
      amount: "100,000 USDC",
      timeline: "T+2, bank-day settlement",
      terms: "Subject to final compliance check",
      notes: "Can split settlement into two equal legs.",
    },
  },
];

const SAMPLE_LOAN_OFFERS: SignalOffer[] = [
  {
    id: "lender-a",
    provider: "Northstar Credit",
    providerMeta: "Structured lender",
    submittedAt: 0,
    source: "sample",
    revealed: false,
    data: {
      interestRate: "8.4% APR",
      amount: "250,000 USDC",
      duration: "30 days",
      collateral: "120% XLM collateral",
      terms: "Daily margin monitoring",
      notes: "Drawdown within one business day.",
    },
  },
  {
    id: "lender-b",
    provider: "Cedar Capital",
    providerMeta: "Treasury lender",
    submittedAt: 0,
    source: "sample",
    revealed: false,
    data: {
      interestRate: "8.9% APR",
      amount: "250,000 USDC",
      duration: "30 days",
      collateral: "110% XLM collateral",
      terms: "Weekly margin monitoring",
      notes: "Flexible prepayment with no penalty.",
    },
  },
  {
    id: "lender-c",
    provider: "Harbor Finance",
    providerMeta: "Alternative credit",
    submittedAt: 0,
    source: "sample",
    revealed: false,
    data: {
      interestRate: "9.2% APR",
      amount: "300,000 USDC",
      duration: "45 days",
      collateral: "100% XLM collateral",
      terms: "Borrower can resize after 15 days",
      notes: "Longer tenor available if required.",
    },
  },
];

const EMPTY_OTC_OFFER: OtcOffer = {
  rate: "",
  amount: "",
  timeline: "",
  terms: "",
  notes: "",
};

const EMPTY_LOAN_OFFER: LoanOffer = {
  interestRate: "",
  amount: "",
  duration: "",
  collateral: "",
  terms: "",
  notes: "",
};

function cloneOffers(type: SignalDealType): SignalOffer[] {
  const source = type === "otc" ? SAMPLE_OTC_OFFERS : SAMPLE_LOAN_OFFERS;
  return source.map((offer) => ({
    ...offer,
    submittedAt: Date.now(),
    data: { ...offer.data },
  }));
}

function durationSeconds(value: DealDuration): number {
  return DEAL_DURATION_OPTIONS.find((option) => option.value === value)?.seconds ?? 5 * 60;
}

function durationLabel(value: DealDuration): string {
  return DEAL_DURATION_OPTIONS.find((option) => option.value === value)?.label ?? "5 min";
}

function uniqueRoomId(prefix: string): string {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now().toString(36)}-${random}`;
}

function isDealDuration(value: unknown): value is DealDuration {
  return DEAL_DURATION_OPTIONS.some((option) => option.value === value);
}

function createRoom(draft: DealDraft, duration: DealDuration = DEFAULT_DURATION_BY_TYPE[draft.type]): PersistedRoom {
  return {
    id: SAMPLE_ROOM_ID,
    draft,
    createdAt: Date.now(),
    deadlineAt: Date.now() + durationSeconds(duration) * 1000,
    status: "collecting",
    selectedProviderId: null,
    revealedAt: null,
    mode: "ReceiptOnly",
    roundId: null,
    transactionHashes: [],
    durationPreset: duration,
  };
}

function isPersistedRoom(value: unknown): value is PersistedRoom {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PersistedRoom>;
  return Boolean(
    typeof candidate.id === "string" &&
      candidate.draft &&
      (candidate.draft.type === "otc" || candidate.draft.type === "loan") &&
      typeof candidate.createdAt === "number" &&
      typeof candidate.deadlineAt === "number" &&
      ["collecting", "ready", "revealed", "selected"].includes(candidate.status ?? "") &&
      (candidate.roundId === null || typeof candidate.roundId === "string"),
  );
}

function loadLegacyRoom(): PersistedRoom {
  if (typeof window === "undefined") return createRoom(DEFAULT_OTC);
  try {
    const value = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null") as PersistedRoom | null;
    if (isPersistedRoom(value)) return value;
  } catch {
    // A malformed demo record should never block the pilot from opening.
  }
  return createRoom(DEFAULT_OTC);
}

function loadRooms(): PersistedRoom[] {
  if (typeof window === "undefined") return [createRoom(DEFAULT_OTC)];
  try {
    const value = JSON.parse(window.localStorage.getItem(ROOMS_STORAGE_KEY) ?? "null") as unknown;
    if (Array.isArray(value)) {
      const rooms = value.filter(isPersistedRoom);
      if (rooms.length > 0) return rooms;
    }
  } catch {
    // Fall back to the original single-room record below.
  }
  return [loadLegacyRoom()];
}

function loadRoom(): PersistedRoom {
  return loadRooms()[0] ?? createRoom(DEFAULT_OTC);
}

function persistRooms(rooms: PersistedRoom[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ROOMS_STORAGE_KEY, JSON.stringify(rooms));
}

function initialOffers(saved = loadRoom()): SignalOffer[] {
  if (saved.roundId) return [];
  if (saved.sampleOffers) return saved.sampleOffers;
  const revealed = saved.status === "revealed" || saved.status === "selected";
  return cloneOffers(saved.draft.type).map((offer) => ({ ...offer, revealed }));
}

function formatDeadline(timestamp: number, now: number): string {
  if (timestamp <= now) return "Deadline passed";
  const remaining = Math.max(0, Math.ceil((timestamp - now) / 1000));
  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  return `${minutes}m ${seconds.toString().padStart(2, "0")}s remaining`;
}

function roomStatusLabel(status: SignalStatus): string {
  return {
    collecting: "Collecting offers",
    ready: "Deadline reached",
    revealed: "Offers revealed",
    selected: "Provider selected",
  }[status];
}

function liveRoundMatches(room: PersistedRoom, roundId: string): boolean {
  return room.roundId === roundId &&
    (!room.network || room.network === STELLAR_NETWORK) &&
    (!room.contractId || room.contractId === CONTRACT_ID);
}

function roomNetworkLabel(room: PersistedRoom): string {
  if (!room.roundId) return "Sample";
  if (room.network === "mainnet") return "Stellar Mainnet";
  if (room.network === "testnet") return "Stellar Testnet";
  return "Live network";
}

function shortId(value: string): string {
  return value.length > 22 ? `${value.slice(0, 10)}...${value.slice(-8)}` : value;
}

function shortAddress(value: string | undefined): string {
  if (!value) return "Not connected";
  return `${value.slice(0, 7)}...${value.slice(-7)}`;
}

function integerAmount(value: string, label: string): bigint {
  const normalized = value.trim().replace(/,/g, "");
  if (!/^\d+$/.test(normalized)) {
    throw new Error(`${label} must be an integer in stroops`);
  }
  const amount = BigInt(normalized);
  if (amount <= 0n) throw new Error(`${label} must be positive`);
  return amount;
}

function durationDays(value: string): number {
  const match = value.match(/\d+(?:\.\d+)?/);
  if (!match) return 1;
  return Math.max(1, Math.round(Number(match[0])));
}

function parseOfferPayload(approach: string | null): Partial<OtcOffer & LoanOffer> {
  if (!approach) return {};
  try {
    const parsed = JSON.parse(approach) as unknown;
    return parsed && typeof parsed === "object" ? parsed as Partial<OtcOffer & LoanOffer> : {};
  } catch {
    return { notes: approach };
  }
}

function liveOfferFromSubmission(
  submission: PilotSubmissionView,
  type: SignalDealType,
): SignalOffer {
  const payload = parseOfferPayload(submission.approach);
  const amount = submission.amount ?? "0";
  const data: SignalOfferData = type === "otc"
    ? {
        rate: payload.rate ?? `${amount} stroops`,
        amount: payload.amount ?? `${amount} stroops`,
        timeline: payload.timeline ?? `${submission.timelineDays ?? 1} day(s)`,
        terms: payload.terms ?? "",
        notes: payload.notes ?? "",
      }
    : {
        interestRate: payload.interestRate ?? `${amount} stroops`,
        amount: payload.amount ?? `${amount} stroops`,
        duration: payload.duration ?? `${submission.timelineDays ?? 1} days`,
        collateral: payload.collateral ?? "",
        terms: payload.terms ?? "",
        notes: payload.notes ?? "",
      };
  return {
    id: `live-${submission.bidder}`,
    provider: submission.bidder,
    providerMeta: "Stellar wallet",
    submittedAt: Date.now(),
    data,
    revealed: true,
    source: "live",
  };
}

function offerFieldRows(offer: SignalOffer, type: SignalDealType): Array<[string, string]> {
  if (type === "otc") {
    const data = offer.data as OtcOffer;
    return [
      ["Rate", data.rate],
      ["Available amount", data.amount],
      ["Settlement", data.timeline],
      ["Terms", data.terms],
      ["Notes", data.notes],
    ];
  }
  const data = offer.data as LoanOffer;
  return [
    ["Interest rate", data.interestRate],
    ["Available amount", data.amount],
    ["Duration", data.duration],
    ["Collateral", data.collateral],
    ["Terms", data.terms],
    ["Notes", data.notes],
  ];
}

function dealRows(draft: DealDraft): Array<[string, string]> {
  if (draft.type === "otc") {
    return [
      ["Side", draft.side === "buy" ? "Buy" : "Sell"],
      ["Asset", draft.asset],
      ["Target", draft.targetAmount],
      ["Settlement window", draft.settlementWindow],
    ];
  }
  return [
    ["Requested amount", draft.requestedAmount],
    ["Asset", draft.asset],
    ["Duration", draft.duration],
    ["Purpose", draft.purpose],
  ];
}

export function SignalPilotPage({ goHome }: { goHome: () => void }) {
  const toast = useToast();
  const [roomList, setRoomList] = useState<PersistedRoom[]>(() => loadRooms());
  const [room, setRoom] = useState<PersistedRoom>(() => loadRoom());
  const [offers, setOffers] = useState<SignalOffer[]>(initialOffers);
  const [liveOffers, setLiveOffers] = useState<SignalOffer[]>([]);
  const [draft, setDraft] = useState<DealDraft>(() => loadRoom().draft);
  const [role, setRole] = useState<SignalRole>("organizer");
  const [mode, setMode] = useState<SignalMode>(() => (loadRoom().roundId ? "live" : "sample"));
  const [durationPreset, setDurationPreset] = useState<DealDuration>(() => {
    const saved = loadRoom();
    return isDealDuration(saved.durationPreset)
      ? saved.durationPreset
      : DEFAULT_DURATION_BY_TYPE[saved.draft.type];
  });
  const [address, setAddress] = useState<string | null>(null);
  const [round, setRound] = useState<RoundV2 | null>(null);
  const [roundInput, setRoundInput] = useState(() => loadRoom().roundId ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [receiptAmount, setReceiptAmount] = useState("1");
  const [now, setNow] = useState(() => Date.now());
  const [copied, setCopied] = useState(false);
  const [confettiTick, setConfettiTick] = useState(0);
  const previousComplete = useRef<boolean | null>(null);
  const [providerName, setProviderName] = useState("Your desk");
  const [providerMeta, setProviderMeta] = useState("Invited provider");
  const [offer, setOffer] = useState<SignalOfferData>(() => {
    const saved = loadRoom();
    return saved.draft.type === "otc" ? { ...EMPTY_OTC_OFFER } : { ...EMPTY_LOAN_OFFER };
  });
  const contract = useWalletContract(address);
  const reader = useReadOnlyContract();
  const sdk = useReadOnlySdk();
  const refreshRequest = useRef(0);
  const liveRoundId = room.roundId ?? roundInput;
  const revealCountdown = useDrandCountdown(round ? Number(round.reveal_round) : 0);

  const deadlinePassed = mode === "live"
    ? Boolean(round && (round.status.tag !== "Open" || Number(round.commit_deadline) * 1000 <= now))
    : room.status !== "collecting" || room.deadlineAt <= now;
  const liveRevealComplete = Boolean(round && (
    round.status.tag === "Cleared" ||
    round.status.tag === "Settled" ||
    (round.status.tag === "Revealing" && liveOffers.length === round.bidders.length)
  ));
  const revealed = mode === "live"
    ? liveRevealComplete || room.status === "selected"
    : room.status === "revealed" || room.status === "selected";
  const visibleOffers = revealed
    ? (mode === "live" ? liveOffers : offers).filter((entry) => entry.revealed)
    : [];
  const selectedOffer = (mode === "live" ? liveOffers : offers).find((entry) => entry.id === room.selectedProviderId);
  const pilotComplete = room.status === "selected";

  useEffect(() => {
    if (previousComplete.current === false && pilotComplete) {
      window.scrollTo({ top: 0, behavior: "smooth" });
      setConfettiTick((current) => current + 1);
    }
    previousComplete.current = pilotComplete;
  }, [pilotComplete]);

  useEffect(() => {
    setRoomList((current) => {
      const index = current.findIndex((entry) => entry.id === room.id);
      if (index < 0) return [...current, room];
      if (JSON.stringify(current[index]) === JSON.stringify(room)) return current;
      const next = current.slice();
      next[index] = room;
      return next;
    });
  }, [room]);

  useEffect(() => {
    persistRooms(roomList);
  }, [roomList]);

  useEffect(() => {
    if (room.roundId) return;
    setRoom((current) => {
      if (JSON.stringify(current.sampleOffers) === JSON.stringify(offers)) return current;
      return { ...current, sampleOffers: offers };
    });
  }, [offers, room.roundId]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (room.status === "collecting" && room.deadlineAt <= now) {
      setRoom((current) => ({ ...current, status: "ready" }));
    }
  }, [now, room]);

  useEffect(() => {
    const parts = window.location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
    const hashRoundId = parts[0] === "pilot" && parts[1] === "the-signal" && /^\d+$/.test(parts[2] ?? "")
      ? parts[2]
      : "";
    if (hashRoundId && hashRoundId !== room.roundId) {
      const existingRoom = roomList.find((entry) => liveRoundMatches(entry, hashRoundId));
      if (existingRoom) {
        activateRoom(existingRoom);
        return;
      }
      const nextRoom: PersistedRoom = {
        ...createRoom({ ...draft }, durationPreset),
        id: uniqueRoomId("signal-live"),
        deadlineAt: Date.now(),
        roundId: hashRoundId,
        network: STELLAR_NETWORK,
        contractId: CONTRACT_ID,
        transactionHashes: [],
      };
      setRoom(nextRoom);
      setMode("live");
      setRoundInput(hashRoundId);
      void refreshLive(hashRoundId, nextRoom.draft.type).catch((error) => toast.push("error", "Live round load failed", displayError(error)));
    }
  }, []);

  useEffect(() => {
    if (mode === "live" && reader && liveRoundId) {
      void refreshLive(liveRoundId).catch((error) => toast.push("error", "Live round load failed", displayError(error)));
    }
  }, [mode, reader]);

  async function refreshLive(target = liveRoundId, dealType = draft.type) {
    if (!reader || !target || !/^\d+$/.test(target)) return;
    const request = ++refreshRequest.current;
    const rid = BigInt(target);
    const roundTx = await reader.get_round_v2({ round_id: rid });
    const nextRound = roundTx.result.unwrap();
    const revealed = await Promise.all(nextRound.bidders.map(async (bidder) => {
      const state = (await reader.get_submission_v2({ round_id: rid, bidder })).result.unwrap();
      if (state.revealed_envelope == null) return null;
      return liveOfferFromSubmission(
        decodePilotSubmission(
          bidder,
          nextRound.mode.tag,
          new Uint8Array(state.revealed_envelope),
          state.valid,
        ),
        dealType,
      );
    }));
    if (request !== refreshRequest.current) return;
    setRound(nextRound);
    const revealedEntries = revealed.filter((entry): entry is SignalOffer => entry !== null);
    setLiveOffers(revealedEntries);
    setRoundInput(target);
    setRoom((current) => {
      const status: SignalStatus = current.status === "selected"
        ? "selected"
        : nextRound.status.tag === "Open"
          ? (Number(nextRound.commit_deadline) * 1000 <= Date.now() ? "ready" : "collecting")
        : nextRound.status.tag === "Revealing" && revealedEntries.length < nextRound.bidders.length
          ? "ready"
          : "revealed";
      return {
        ...current,
        id: current.roundId === target ? current.id : uniqueRoomId("signal-live"),
        roundId: target,
        deadlineAt: Number(nextRound.commit_deadline) * 1000,
        status,
        mode: "ReceiptOnly",
        network: STELLAR_NETWORK,
        contractId: CONTRACT_ID,
      };
    });
  }

  function activateRoom(nextRoom: PersistedRoom) {
    setRoom(nextRoom);
    setDraft(nextRoom.draft);
    setDurationPreset(
      isDealDuration(nextRoom.durationPreset)
        ? nextRoom.durationPreset
        : DEFAULT_DURATION_BY_TYPE[nextRoom.draft.type],
    );
    setOffers(initialOffers(nextRoom));
    setLiveOffers([]);
    setRound(null);
    setRoundInput(nextRoom.roundId ?? "");
    setRole("organizer");
    const nextMode: SignalMode = nextRoom.roundId ? "live" : "sample";
    setMode(nextMode);
    if (nextRoom.roundId) {
      void refreshLive(nextRoom.roundId, nextRoom.draft.type).catch((error) => {
        toast.push("error", "Live round load failed", displayError(error));
      });
    }
  }

  function transactionHash(result: unknown): string | null {
    const hash = (result as { sendTransactionResponse?: { hash?: unknown } })
      .sendTransactionResponse?.hash;
    return typeof hash === "string" && hash ? hash : null;
  }

  function rememberTransaction(hash: string | null) {
    if (!hash) return;
    setRoom((current) => ({
      ...current,
      transactionHashes: Array.from(new Set([...(current.transactionHashes ?? []), hash])),
    }));
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
      setMode("live");
      toast.push("success", "Wallet connected", shortAddress(nextAddress));
    } catch (error) {
      toast.push("error", "Wallet connection failed", displayError(error));
    } finally {
      setBusy(null);
    }
  }

  async function createLiveDeal() {
    if (!contract || !address) {
      toast.push("error", "Wallet required", "Connect Freighter before creating a live deal room.");
      return;
    }
    setBusy("create");
    try {
      if (!CONTRACT_ID) throw new Error("No Core v2 contract is configured for this network");
      if (!draft.title.trim()) throw new Error("Enter a deal title");
      toast.push("info", "Preparing live deal room", "The next step will open a Freighter signature request.");
      const drand = quicknet();
      const commitSeconds = durationSeconds(durationPreset);
      const revealRound = await roundInSeconds(drand, commitSeconds + 15);
      const info = await drand.chain().info();
      const revealAt = drandRoundTime(revealRound, info);
      const auditor = generateAuditorKeypair();
      const itemRef = await sha256Bytes(`${draft.title}:${draft.asset}:${Date.now()}`);
      const tx = await contract.create_partner_round_v2({
        operator: address,
        item_ref: Buffer.from(itemRef),
        schema_ref: Buffer.from(SEALED_PROPOSAL_SCHEMA_REF),
        policy: {
          settlement: {
            mode: { tag: "ReceiptOnly", values: undefined },
            payment_asset: undefined,
            lot_asset: undefined,
            lot_amount: 0n,
          },
          fixed_escrow: 0n,
          eligible_participants: [],
        },
        reveal_round: BigInt(revealRound),
        clearing_rule: { tag: "LowestBid", values: undefined },
        commit_deadline: BigInt(revealAt - 10),
        reveal_deadline: BigInt(revealAt + 300),
        auditor_pubkey: Buffer.from(auditor.publicKey),
        max_participants: 25,
      });
      const sent = await tx.signAndSend();
      const nextId = sent.result.unwrap().toString();
      const hash = transactionHash(sent);
      const nextRoom: PersistedRoom = {
        ...createRoom({ ...draft }, durationPreset),
        id: uniqueRoomId("signal-live"),
        deadlineAt: (revealAt - 10) * 1000,
        roundId: nextId,
        network: STELLAR_NETWORK,
        contractId: CONTRACT_ID,
        transactionHashes: hash ? [hash] : [],
        durationPreset,
      };
      setMode("live");
      setRoom(nextRoom);
      setOffers([]);
      setLiveOffers([]);
      setRoundInput(nextId);
      window.location.hash = `#/pilot/the-signal/${nextId}`;
      await refreshLive(nextId);
      toast.push("success", "Live deal room created", `ReceiptOnly round #${nextId}`);
    } catch (error) {
      toast.push("error", "Live room creation failed", displayError(error));
    } finally {
      setBusy(null);
    }
  }

  async function loadLiveRoom() {
    setBusy("load");
    try {
      const target = roundInput.trim();
      if (!/^\d+$/.test(target)) throw new Error("Round ID must be a whole number");
      const existingRoom = roomList.find((entry) => liveRoundMatches(entry, target));
      if (existingRoom) {
        activateRoom(existingRoom);
        toast.push("success", "Live room selected", `ReceiptOnly round #${target}`);
        return;
      }
      const nextRoom: PersistedRoom = {
        ...createRoom({ ...draft }, durationPreset),
        id: uniqueRoomId("signal-live"),
        deadlineAt: Date.now(),
        roundId: target,
        network: STELLAR_NETWORK,
        contractId: CONTRACT_ID,
        transactionHashes: [],
      };
      setRoom(nextRoom);
      setMode("live");
      setRound(null);
      setLiveOffers([]);
      window.location.hash = `#/pilot/the-signal/${target}`;
      await refreshLive(target, nextRoom.draft.type);
    } catch (error) {
      toast.push("error", "Live round load failed", displayError(error));
    } finally {
      setBusy(null);
    }
  }

  async function submitLiveOffer() {
    if (!contract || !address || !round || !liveRoundId) {
      toast.push("error", "Live round required", "Connect a wallet and load or create a live deal room first.");
      return;
    }
    setBusy("submit");
    try {
      if (round.status.tag !== "Open") throw new Error("This round is no longer accepting offers");
      const amount = integerAmount(receiptAmount, "Receipt amount");
      const serializedOffer = JSON.stringify({
        ...(offer as unknown as Record<string, string>),
        provider: providerName.trim() || "Wallet provider",
        providerMeta: providerMeta.trim() || "Stellar wallet",
      });
      const drand = quicknet();
      const sealed = await sealProposal({
        round: Number(round.reveal_round),
        drand,
        identity: new TextEncoder().encode(address),
        auditorPublicKey: new Uint8Array(round.auditor_pubkey),
        price: amount,
        proposal: {
          timelineDays: draft.type === "loan" ? durationDays((offer as LoanOffer).duration) : durationDays(draft.settlementWindow),
          approach: serializedOffer,
        },
      });
      const tx = await contract.commit_v2({
        round_id: BigInt(liveRoundId),
        bidder: address,
        commitment: Buffer.from(sealed.commitment),
        ciphertext: Buffer.from(sealed.ciphertext),
        escrow: 0n,
        auditor_blob: Buffer.from(sealed.auditorBlob),
      });
      const sent = await tx.signAndSend();
      rememberTransaction(transactionHash(sent));
      await refreshLive();
      toast.push("success", "Private offer submitted", `Sealed on ReceiptOnly round #${liveRoundId}`);
    } catch (error) {
      toast.push("error", "Offer submission failed", displayError(error));
    } finally {
      setBusy(null);
    }
  }

  async function revealLiveOffers() {
    if (!contract || !round || !liveRoundId) return;
    if (round.status.tag === "Open" && !revealCountdown.published) return;
    setBusy("reveal");
    try {
      const rid = BigInt(liveRoundId);
      const drand = quicknet();
      let current = (await contract.get_round_v2({ round_id: rid })).result.unwrap();
      if (current.status.tag === "Open") {
        const signature = await fetchRoundSignature(drand, Number(current.reveal_round));
        try {
          const open = await contract.open_reveal_v2({ round_id: rid, drand_signature: Buffer.from(signature) });
          const sent = await open.signAndSend();
          rememberTransaction(transactionHash(sent));
        } catch (error) {
          if (!isRevealAlreadyOpen(error)) throw error;
        }
        current = (await contract.get_round_v2({ round_id: rid })).result.unwrap();
      }
      const bidders = (await contract.get_bidders_v2({ round_id: rid })).result.unwrap();
      let revealedCount = 0;
      for (const bidder of bidders) {
        const state = (await contract.get_submission_v2({ round_id: rid, bidder })).result.unwrap();
        if (state.revealed_envelope != null) continue;
        const seal = (await contract.get_seal_v2({ round_id: rid, bidder })).result;
        if (!seal) throw new Error(`Encrypted offer is unavailable for ${shortAddress(bidder)}`);
        const envelope = await openPayload(new Uint8Array(seal.ciphertext), drand);
        try {
          const reveal = await contract.reveal_v2({
            round_id: rid,
            bidder,
            envelope: Buffer.from(encodePayloadEnvelope(envelope)),
          });
          const sent = await reveal.signAndSend();
          rememberTransaction(transactionHash(sent));
          revealedCount += 1;
        } catch (error) {
          if (!isSubmissionAlreadyRevealed(error)) throw error;
        }
      }
      await refreshLive();
      toast.push("success", "Offers revealed", `${revealedCount} on-chain submission(s) opened`);
    } catch (error) {
      toast.push("error", "Reveal failed", displayError(error));
    } finally {
      setBusy(null);
    }
  }

  async function downloadLiveReceipt() {
    if (!sdk || !liveRoundId) return;
    setBusy("receipt");
    try {
      const receipt = await sdk.exportReceiptV2(BigInt(liveRoundId));
      const verification = verifyReceiptV2(receipt);
      if (!verification.valid) throw new Error("Receipt verification failed");
      const blob = new Blob([serializeReceiptV2(receipt)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `sub-rosa-signal-round-${liveRoundId}-receipt.json`;
      link.click();
      URL.revokeObjectURL(url);
      toast.push("success", "Receipt verified", `Round #${liveRoundId} downloaded`);
    } catch (error) {
      toast.push("error", "Receipt export failed", displayError(error));
    } finally {
      setBusy(null);
    }
  }

  function switchType(type: SignalDealType) {
    const nextDraft = type === "otc" ? { ...DEFAULT_OTC } : { ...DEFAULT_LOAN };
    setDraft(nextDraft);
    setDurationPreset(DEFAULT_DURATION_BY_TYPE[type]);
    setOffer(type === "otc" ? { ...EMPTY_OTC_OFFER } : { ...EMPTY_LOAN_OFFER });
  }

  function updateDraft<K extends keyof DealDraft>(key: K, value: DealDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function updateOffer(key: string, value: string) {
    setOffer((current) => ({ ...current, [key]: value } as SignalOfferData));
  }

  function resetRoom() {
    const nextDraft = draft.type === "otc" ? { ...DEFAULT_OTC } : { ...DEFAULT_LOAN };
    const nextDuration = DEFAULT_DURATION_BY_TYPE[nextDraft.type];
    const nextRoom = createRoom(nextDraft, nextDuration);
    setDraft(nextDraft);
    setRoom(nextRoom);
    setOffers(cloneOffers(nextDraft.type));
    setLiveOffers([]);
    setRound(null);
    setRoundInput("");
    setMode("sample");
    setDurationPreset(nextDuration);
    setRole("organizer");
    setOffer(nextDraft.type === "otc" ? { ...EMPTY_OTC_OFFER } : { ...EMPTY_LOAN_OFFER });
  }

  function createDeal() {
    const nextRoom = {
      ...createRoom({ ...draft }, durationPreset),
      id: uniqueRoomId(`signal-${draft.type}`),
    };
    setRoom(nextRoom);
    setOffers([]);
    setRole("organizer");
  }

  function simulateDeadline() {
    setRoom((current) => ({
      ...current,
      deadlineAt: Date.now() - 1000,
      status: "ready",
    }));
    setNow(Date.now());
  }

  function revealOffers() {
    if (!deadlinePassed || room.status === "selected") return;
    setOffers((current) => current.map((entry) => ({ ...entry, revealed: true })));
    setRoom((current) => ({
      ...current,
      status: "revealed",
      revealedAt: Date.now(),
    }));
  }

  function submitOffer() {
    if (!providerName.trim()) return;
    const newOffer: SignalOffer = {
      id: `provider-${Date.now().toString(36)}`,
      provider: providerName.trim(),
      providerMeta: providerMeta.trim() || "Invited provider",
      submittedAt: Date.now(),
      source: "demo",
      revealed: false,
      data: { ...offer } as SignalOfferData,
    };
    setOffers((current) => [...current, newOffer]);
    setRole("provider");
  }

  function selectProvider(providerId: string) {
    setRoom((current) => ({
      ...current,
      selectedProviderId: providerId,
      status: "selected",
    }));
  }

  async function copyRoomLink() {
    const suffix = mode === "live" && liveRoundId ? `/${liveRoundId}` : "";
    const url = `${window.location.origin}${window.location.pathname}#/pilot/the-signal${suffix}`;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  const statusLabel = {
    collecting: "Collecting offers",
    ready: "Deadline reached",
    revealed: "Offers revealed",
    selected: "Provider selected",
  }[room.status];

  const progress = [
    { label: "Create deal", done: true },
    { label: "Private offers", done: (mode === "live" ? round?.bidders.length ?? 0 : offers.length) > 0 },
    { label: "Deadline", done: deadlinePassed },
    { label: "Reveal", done: revealed },
    { label: "Select", done: room.status === "selected" },
  ];

  return (
    <main className="signal-pilot-page">
      <ConfettiBurst fire={confettiTick} count={48} />
      <nav className="signal-pilot-nav">
        <button type="button" className="brand-link" onClick={goHome}>
          <img src={LOGO_SRC} alt="" />
          <span>Sub Rosa</span>
        </button>
        <div className="signal-pilot-nav-actions">
          <span className="signal-pilot-network">{mode === "live" ? `${NETWORK_LABEL} · Live ReceiptOnly` : "Sample walkthrough"}</span>
          <div className="signal-mode-switch" role="tablist" aria-label="Pilot mode">
            <button type="button" className={mode === "sample" ? "active" : ""} onClick={() => setMode("sample")}>Sample</button>
            <button type="button" className={mode === "live" ? "active" : ""} onClick={() => setMode("live")}>Live</button>
          </div>
          <a href="#/docs" className="secondary-action compact">Docs</a>
          {mode === "sample" && <button type="button" className="secondary-action compact" onClick={() => setMode("live")}>Use live mode</button>}
          <button type="button" className="secondary-action compact" onClick={connect} disabled={busy !== null}>
            {address ? shortAddress(address) : busy === "connect" ? "Connecting..." : "Connect wallet"}
          </button>
        </div>
      </nav>

      <section className="signal-pilot-hero">
        <div>
          <span className="signal-pilot-kicker"><ShieldCheck size={15} /> The Signal-style deal flow</span>
          <h1>Confidential offers.<br /><em>Clear decisions.</em></h1>
          <p>Run a simple OTC or loan deal room with private provider offers, a shared deadline, and an organizer-owned selection.</p>
          <div className="signal-pilot-boundary">
            {mode === "live" ? <><ShieldCheck size={15} /> Live ReceiptOnly · wallet signatures required · no escrow · {NETWORK_LABEL}</> : <><KeyRound size={15} /> Sample state only · no transaction is claimed · no escrow · no The Signal production integration</>}
          </div>
        </div>
        <div className="signal-pilot-hero-actions">
          <img className="pilot-partner-mark" src="/pilots/the-signal/the-signal-logo.png" alt="The Signal" />
          <div className="signal-hero-action-row">
            <button type="button" className="primary-action" onClick={() => setRole("organizer")}><Users size={16} />Open organizer view</button>
            <button type="button" className="secondary-action" onClick={() => setRole("provider")}><LockKeyhole size={16} />Submit as provider</button>
          </div>
        </div>
      </section>

      <section className="signal-pilot-flow" aria-label="Deal flow">
        {progress.map((step, index) => (
          <div className={step.done ? "done" : ""} key={step.label}>
            <span>{step.done ? <CheckCircle2 size={15} /> : index + 1}</span>
            <strong>{step.label}</strong>
            {index < progress.length - 1 && <ArrowRight size={15} aria-hidden="true" />}
          </div>
        ))}
      </section>

      <section className="signal-pilot-layout">
        <div className="signal-pilot-primary">
          <section className="signal-panel signal-deal-panel">
            <div className="signal-panel-heading">
              <div><span>Organizer request</span><h2>Deal room setup</h2></div>
              <div className="signal-template-switch" role="tablist" aria-label="Deal type">
                <button type="button" className={draft.type === "otc" ? "active" : ""} onClick={() => switchType("otc")}>OTC deal</button>
                <button type="button" className={draft.type === "loan" ? "active" : ""} onClick={() => switchType("loan")}>Loan deal</button>
              </div>
            </div>
            <div className="signal-form">
              <label>Deal title<input value={draft.title} onChange={(event) => updateDraft("title", event.target.value)} /></label>
              {draft.type === "otc" ? (
                <div className="signal-form-grid">
                  <label>Side<select value={draft.side} onChange={(event) => updateDraft("side", event.target.value as DealDraft["side"])}><option value="buy">Buy</option><option value="sell">Sell</option></select></label>
                  <label>Asset<input value={draft.asset} onChange={(event) => updateDraft("asset", event.target.value)} /></label>
                  <label>Target amount<input value={draft.targetAmount} onChange={(event) => updateDraft("targetAmount", event.target.value)} /></label>
                  <label>Settlement window<input value={draft.settlementWindow} onChange={(event) => updateDraft("settlementWindow", event.target.value)} /></label>
                </div>
              ) : (
                <div className="signal-form-grid">
                  <label>Requested amount<input value={draft.requestedAmount} onChange={(event) => updateDraft("requestedAmount", event.target.value)} /></label>
                  <label>Asset<input value={draft.asset} onChange={(event) => updateDraft("asset", event.target.value)} /></label>
                  <label>Duration<input value={draft.duration} onChange={(event) => updateDraft("duration", event.target.value)} /></label>
                  <label>Purpose<input value={draft.purpose} onChange={(event) => updateDraft("purpose", event.target.value)} /></label>
                </div>
              )}
              <label>Organizer notes<textarea value={draft.notes} onChange={(event) => updateDraft("notes", event.target.value)} rows={3} /></label>
              <label>Offer window<select value={durationPreset} onChange={(event) => setDurationPreset(event.target.value as DealDuration)}>{DEAL_DURATION_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
              {mode === "live" && <div className="signal-live-load"><label>Existing live round ID<input inputMode="numeric" placeholder="e.g. 12" value={roundInput} onChange={(event) => setRoundInput(event.target.value)} /></label><button type="button" className="secondary-action compact" onClick={loadLiveRoom} disabled={busy !== null}><RotateCcw size={15} />Load round</button></div>}
              <div className="signal-form-actions"><button type="button" className="primary-action" onClick={mode === "live" ? createLiveDeal : createDeal} disabled={busy !== null}>{busy === "create" ? "Waiting for wallet..." : <><FileCheck2 size={16} />{mode === "live" ? "Create live deal room" : "Create sample deal room"}</>}</button><button type="button" className="secondary-action" onClick={resetRoom} disabled={busy !== null}><RotateCcw size={16} />Reset local room</button></div>
              <p className="signal-helper">{mode === "live" ? `Creates a real Core v2 ReceiptOnly round with a ${durationLabel(durationPreset)} commit window. Freighter asks you to sign; network fees are paid by the connected wallet.` : `Sample mode uses a ${durationLabel(durationPreset)} local offer window. Switch to Live to create a real on-chain room.`}</p>
            </div>
          </section>

          <section className="signal-room-switcher" aria-label="Deal rooms">
            <div className="signal-room-switcher-heading">
              <div><span>Workspace</span><h2>Your deal rooms</h2></div>
              <span className="signal-room-count">{roomList.length} room{roomList.length === 1 ? "" : "s"}</span>
            </div>
            <div className="signal-room-card-grid">
              {roomList.map((entry) => (
                <button
                  type="button"
                  className={`signal-room-card ${entry.id === room.id ? "active" : ""}`}
                  key={entry.id}
                  onClick={() => activateRoom(entry)}
                  aria-pressed={entry.id === room.id}
                >
                  <div className="signal-room-card-topline">
                    <span>{entry.draft.type === "otc" ? "OTC deal" : "Loan deal"}</span>
                    <strong>{roomStatusLabel(entry.status)}</strong>
                  </div>
                  <h3>{entry.draft.title}</h3>
                  <dl>
                    <div><dt>Room key</dt><dd>{shortId(entry.id)}</dd></div>
                    <div><dt>On-chain round</dt><dd>{entry.roundId ? `#${entry.roundId}` : "Not created"}</dd></div>
                    <div><dt>Deadline</dt><dd>{formatDeadline(entry.deadlineAt, now)}</dd></div>
                    <div><dt>Network</dt><dd>{roomNetworkLabel(entry)}</dd></div>
                    {entry.contractId && <div><dt>Contract</dt><dd>{shortAddress(entry.contractId)}</dd></div>}
                  </dl>
                </button>
              ))}
            </div>
            <p className="signal-helper">Each room is separate. Select a card to continue that deal; creating another room keeps this one here. On-chain round numbers are scoped to a network and contract, while the Room key identifies this browser card.</p>
          </section>

          <section className="signal-panel signal-request-panel">
            <div className="signal-panel-heading"><div><span>Deal room</span><h2>{draft.title}</h2></div><span className={`signal-status ${room.status}`}>{statusLabel}</span></div>
            <div className="signal-request-body">
              <div className="signal-request-summary"><dl>{dealRows(draft).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || "Not set"}</dd></div>)}</dl><p>{draft.notes}</p></div>
              <div className="signal-room-meta"><div><span>Room key</span><code>{shortId(room.id)}</code></div><div><span>On-chain round</span><strong>{room.roundId ? `#${room.roundId}` : "Not created"}</strong></div>{room.contractId && <div><span>Contract</span><strong>{shortAddress(room.contractId)}</strong></div>}<div><span>Deadline</span><strong>{formatDeadline(room.deadlineAt, now)}</strong></div><div><span>Mode</span><strong>ReceiptOnly</strong></div><div><span>Escrow</span><strong>None</strong></div><button type="button" className="secondary-action compact" onClick={copyRoomLink}><Clipboard size={15} />{copied ? "Copied" : "Copy room link"}</button></div>
            </div>
          </section>
        </div>

        <aside className="signal-pilot-sidebar">
          <section className="signal-panel signal-role-panel">
            <div className="signal-panel-heading"><div><span>Deal room role</span><h2>{role === "organizer" ? "Organizer view" : "Provider view"}</h2></div><span className="signal-demo-badge">{mode === "live" ? "LIVE MODE" : "SAMPLE MODE"}</span></div>
            <div className="signal-role-switch"><button type="button" className={role === "organizer" ? "active" : ""} onClick={() => setRole("organizer")}>Organizer</button><button type="button" className={role === "provider" ? "active" : ""} onClick={() => setRole("provider")}>Provider</button></div>
            {role === "organizer" ? (
              <div className="signal-organizer-view">
                <div className="signal-stat-row"><div><span>Providers submitted</span><strong>{mode === "live" ? round?.bidders.length ?? 0 : offers.length}</strong></div><div><span>Offers visible</span><strong>{revealed ? visibleOffers.length : "Hidden"}</strong></div></div>
                <div className="signal-private-state"><LockKeyhole size={18} /><div><strong>{revealed ? "Offers are now visible" : "Offers stay private until the deadline"}</strong><p>{revealed ? "Every valid offer opened together. Selection remains an organizer decision." : "Provider names and submission count are public. Rate, amount, timeline, and terms are not."}</p></div></div>
                <div className="signal-provider-list">{(mode === "live" ? (round?.bidders ?? []).map((bidder) => ({ id: `live-${bidder}`, provider: bidder, providerMeta: "Stellar wallet", revealed: liveOffers.some((entry) => entry.provider === bidder) })) : offers).map((entry) => <div key={entry.id}><span className="signal-provider-dot" /> <div><strong>{shortAddress(entry.provider)}</strong><span>{entry.providerMeta}</span></div><code>{entry.revealed ? "revealed" : "sealed"}</code></div>)}</div>
                <div className="signal-organizer-actions">
                  {mode === "sample" && !deadlinePassed && <button type="button" className="secondary-action" onClick={simulateDeadline}><UnlockKeyhole size={16} />Simulate deadline</button>}
                  {mode === "sample" && deadlinePassed && !revealed && <button type="button" className="primary-action" onClick={revealOffers}><UnlockKeyhole size={16} />Reveal sample offers</button>}
                  {mode === "live" && !liveRoundId && <span className="signal-reveal-note"><KeyRound size={15} />Create or load a live round first</span>}
                  {mode === "live" && liveRoundId && !deadlinePassed && <span className="signal-reveal-note"><LockKeyhole size={15} />Commit deadline is still open</span>}
                  {mode === "live" && liveRoundId && deadlinePassed && !revealed && <button type="button" className="primary-action" onClick={revealLiveOffers} disabled={busy !== null || !revealCountdown.published}><UnlockKeyhole size={16} />{busy === "reveal" ? "Revealing..." : revealCountdown.published ? "Open + reveal on-chain" : `Reveal in ${revealCountdown.secondsRemaining}s`}</button>}
                  {revealed && <span className="signal-reveal-note"><CheckCircle2 size={15} />All offers opened together</span>}
                </div>
              </div>
            ) : (
              <div className="signal-provider-view">
                <div className="signal-provider-callout"><LockKeyhole size={18} /><p>Only your offer is visible in this view. The organizer sees a sealed submission until the deadline.</p></div>
                <div className="signal-form">
                  <label>Provider name<input value={providerName} onChange={(event) => setProviderName(event.target.value)} /></label>
                  <label>Desk or provider type<input value={providerMeta} onChange={(event) => setProviderMeta(event.target.value)} /></label>
                  {draft.type === "otc" ? (
                    <>
                      <label>Price / rate<input placeholder="0.00001350 USDC / XLM" value={(offer as OtcOffer).rate} onChange={(event) => updateOffer("rate", event.target.value)} /></label>
                      <label>Available amount<input placeholder="100,000 USDC" value={(offer as OtcOffer).amount} onChange={(event) => updateOffer("amount", event.target.value)} /></label>
                      <label>Settlement timeline<input placeholder="T+1" value={(offer as OtcOffer).timeline} onChange={(event) => updateOffer("timeline", event.target.value)} /></label>
                      <label>Terms<textarea placeholder="Quote validity, venue, conditions" value={(offer as OtcOffer).terms} onChange={(event) => updateOffer("terms", event.target.value)} rows={2} /></label>
                      <label>Notes<textarea placeholder="Optional private notes" value={(offer as OtcOffer).notes} onChange={(event) => updateOffer("notes", event.target.value)} rows={2} /></label>
                    </>
                  ) : (
                    <>
                      <label>Interest rate<input placeholder="8.5% APR" value={(offer as LoanOffer).interestRate} onChange={(event) => updateOffer("interestRate", event.target.value)} /></label>
                      <label>Available amount<input placeholder="250,000 USDC" value={(offer as LoanOffer).amount} onChange={(event) => updateOffer("amount", event.target.value)} /></label>
                      <label>Duration<input placeholder="30 days" value={(offer as LoanOffer).duration} onChange={(event) => updateOffer("duration", event.target.value)} /></label>
                      <label>Collateral requirements<textarea placeholder="Collateral and monitoring terms" value={(offer as LoanOffer).collateral} onChange={(event) => updateOffer("collateral", event.target.value)} rows={2} /></label>
                      <label>Terms<textarea placeholder="Optional offer terms" value={(offer as LoanOffer).terms} onChange={(event) => updateOffer("terms", event.target.value)} rows={2} /></label>
                      <label>Notes<textarea placeholder="Optional private notes" value={(offer as LoanOffer).notes} onChange={(event) => updateOffer("notes", event.target.value)} rows={2} /></label>
                    </>
                  )}
                  {mode === "live" && <label>Receipt amount (integer stroops)<input inputMode="numeric" placeholder="1" value={receiptAmount} onChange={(event) => setReceiptAmount(event.target.value)} /></label>}
                  <button type="button" className="primary-action" onClick={mode === "live" ? submitLiveOffer : submitOffer} disabled={deadlinePassed || busy !== null || (mode === "live" && (!liveRoundId || !round))}><LockKeyhole size={16} />{mode === "live" ? (busy === "submit" ? "Waiting for wallet..." : "Submit private offer on-chain") : "Submit sample offer"}</button>
                </div>
                <p className="signal-helper">{mode === "live" ? "The offer is encrypted locally, then commit_v2 is signed by this wallet. ReceiptOnly has no escrow." : "Sample mode records a demo-layer sealed offer. It does not claim an on-chain transaction."}</p>
              </div>
            )}
          </section>
        </aside>

        {revealed && (
          <section className="signal-panel signal-offers-panel">
            <div className="signal-panel-heading"><div><span>After the deadline</span><h2>Compare revealed offers</h2></div><span className="signal-reveal-note"><UnlockKeyhole size={15} />Permissionless reveal</span></div>
            <div className="signal-offer-grid">
              {visibleOffers.map((entry) => (
                <article className={`signal-offer ${room.selectedProviderId === entry.id ? "selected" : ""}`} key={entry.id}>
                  <div className="signal-offer-heading"><div><span>{entry.providerMeta}</span><h3>{entry.provider}</h3></div>{room.selectedProviderId === entry.id && <span className="signal-selected-badge"><CheckCircle2 size={14} />Selected</span>}</div>
                  <dl>{offerFieldRows(entry, draft.type).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
                  <button type="button" className={room.selectedProviderId === entry.id ? "secondary-action compact" : "primary-action compact"} onClick={() => selectProvider(entry.id)} disabled={room.status === "selected" && room.selectedProviderId !== entry.id}>{room.selectedProviderId === entry.id ? "Selected provider" : "Select provider"}<ArrowRight size={15} /></button>
                </article>
              ))}
            </div>
            <p className="signal-selection-note"><ShieldCheck size={15} />The protocol reveals the submitted set. The organizer's provider selection is an off-chain business decision.</p>
          </section>
        )}

        {revealed && (
          <section className="signal-panel signal-receipt-panel">
            <div className="signal-panel-heading"><div><span>Verifiable record</span><h2>Pilot receipt</h2></div><FileCheck2 size={20} /></div>
              <div className="signal-receipt-grid"><dl><div><dt>Deal type</dt><dd>{draft.type === "otc" ? "OTC" : "Loan"}</dd></div><div><dt>Room ID</dt><dd><code>{room.id}</code></dd></div><div><dt>Protocol mode</dt><dd>ReceiptOnly</dd></div><div><dt>Submissions</dt><dd>{mode === "live" ? round?.bidders.length ?? 0 : offers.length}</dd></div></dl><dl><div><dt>Reveal status</dt><dd>{room.revealedAt ? `Revealed ${new Date(room.revealedAt).toLocaleString()}` : revealed ? "Revealed on-chain" : "Not revealed"}</dd></div><div><dt>Selected provider</dt><dd>{selectedOffer ? shortAddress(selectedOffer.provider) : "Not selected"}</dd></div><div><dt>On-chain round</dt><dd>{room.roundId ? <code>{room.roundId}</code> : "Not created in sample mode"}</dd></div><div><dt>Stellar transactions</dt><dd>{(room.transactionHashes ?? []).length}</dd></div></dl></div>
            <div className="signal-receipt-footer"><div><p>{mode === "live" ? "This receipt is built from the live Core v2 round. Provider selection remains an off-chain organizer decision; only the sealed set and reveal evidence are on-chain." : "This sample room is a standalone validation surface. It does not claim on-chain transactions."}</p>{mode === "live" && (room.transactionHashes ?? []).length > 0 && <div className="signal-tx-list">{(room.transactionHashes ?? []).map((hash) => <a key={hash} href={stellarExpertTxLink(hash)} target="_blank" rel="noreferrer"><code>{shortId(hash)}</code><ArrowRight size={13} /></a>)}</div>}</div><div className="signal-receipt-actions">{mode === "live" && <button type="button" className="secondary-action compact" onClick={downloadLiveReceipt} disabled={busy !== null}><FileCheck2 size={15} />Download verified receipt</button>}{mode === "sample" && <button type="button" className="secondary-action compact" onClick={() => setMode("live")}><ArrowRight size={15} />Switch to live mode</button>}</div></div>
          </section>
        )}
      </section>

      <footer className="signal-pilot-footer"><span><KeyRound size={14} />Standalone pilot environment</span><span>This mimics a confidential deal-flow workflow and does not require integration with The Signal's production systems.</span><a href="#/docs">Read the integration docs<X size={13} /></a></footer>
    </main>
  );
}
