import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  CheckCircle2,
  Clipboard,
  Code2,
  ExternalLink,
  FileCheck2,
  KeyRound,
  Menu,
  Package,
  Search,
  Server,
  ShieldCheck,
  Terminal,
  X,
} from "lucide-react";

import {
  SUB_ROSA_DEPLOYMENTS,
  SUB_ROSA_REVEAL_POLICY_V3_DEPLOYMENTS,
  REVEAL_POLICY_V3_WASM_HASH,
} from "@sub-rosa/sdk";
import sdkPackage from "../../../../packages/sdk/package.json";
import tlockPackage from "../../../../packages/tlock/package.json";
import bindingsPackage from "../../../../packages/round-bindings/package.json";
import { ECOSYSTEM_PARTNERS } from "../config/ecosystem";
import { PILOT_WORKSPACES } from "../config/pilotWorkspaces";
import { LOGO_SRC } from "../lib/chain";

const TESTNET_DEPLOYMENT = SUB_ROSA_DEPLOYMENTS.testnet;
const MAINNET_DEPLOYMENT = SUB_ROSA_DEPLOYMENTS.mainnet;
const CONTRACT_ID = TESTNET_DEPLOYMENT.contractId;
const WASM_HASH = "2c7bc6b4c91940ac185df38a3d0a8532b555140d818df94f03f894e5952ebf42";
const REVEAL_V3_TESTNET = SUB_ROSA_REVEAL_POLICY_V3_DEPLOYMENTS.testnet;
const REVEAL_V3_CONTRACT_ID = REVEAL_V3_TESTNET.contractId;
const SDK_VERSION = sdkPackage.version;
const TLOCK_VERSION = tlockPackage.version;
const BINDINGS_VERSION = bindingsPackage.version;

type SectionLink = { id: string; label: string; keywords: string };
type NavGroup = { label: string; items: SectionLink[] };

const NAV_GROUPS: NavGroup[] = [
  {
    label: "Start",
    items: [
      { id: "overview", label: "Overview", keywords: "architecture modes stellar soroban" },
      { id: "quickstart", label: "Quickstart", keywords: "install npm node 22 environment friendbot testnet live example expected output transaction explorer receipt verify" },
      { id: "choose-mode", label: "Choose a mode", keywords: "auction receipt proposal" },
      { id: "network", label: "Network & contract", keywords: "testnet rpc wasm deployment" },
    ],
  },
  {
    label: "Build",
    items: [
      { id: "auction", label: "Asset auction", keywords: "seller lot custody fixed escrow bidder" },
      { id: "proposal", label: "Sealed proposal", keywords: "signal procurement receipt only" },
      { id: "browser-wallets", label: "Browser wallets", keywords: "freighter requestAccess isConnected getNetworkDetails signTransaction signAuthEntry rejection frontend bindings wallet security" },
      { id: "integrations", label: "Integrations & examples", keywords: "pollar cosmos pay proofwork offer hub stelhacks trustless work acta signal openx402 partner pilots examples" },
      { id: "timing", label: "Drand & deadlines", keywords: "round reveal commit timestamp" },
      { id: "lifecycle", label: "Lifecycle & keeper", keywords: "open reveal clear settle void automation" },
      { id: "owner-reveal", label: "Owner-triggered reveal", keywords: "protocol 3 v3 policy fallback operator manual reveal open createRoundV3 supportsRevealPolicy getRevealStateV3 require_auth" },
    ],
  },
  {
    label: "Verify",
    items: [
      { id: "policies", label: "Policy & eligibility", keywords: "allowlist fixed escrow privacy" },
      { id: "receipts", label: "Canonical receipts", keywords: "export verify json proof" },
      { id: "read-api", label: "Read API", keywords: "round bidders submissions seals config" },
      { id: "preflight", label: "Preflight", keywords: "simulate errors fees resources" },
    ],
  },
  {
    label: "Reference",
    items: [
      { id: "api-reference", label: "SDK reference", keywords: "createAssetAuctionRound createSealedProposalRound createRoundV3 supportsRevealPolicy getRevealStateV3 sealAssetBid sealProposal submitV2 commitV2 openRevealV2 revealV2 clearV2 settleV2 voidV2 getRoundV2 getRoundPolicyV2 getSubmissionV2 getBiddersV2 getSealV2 exportReceiptV2 methods parameters return types typed errors preflight" },
      { id: "errors", label: "Errors & recovery", keywords: "contract codes troubleshooting" },
      { id: "security", label: "Security boundary", keywords: "audit production trust threat" },
      { id: "deployment", label: "Deployment checklist", keywords: "production test deploy monitor" },
    ],
  },
];

const ALL_LINKS = NAV_GROUPS.flatMap((group) => group.items);
const SECTION_IDS = new Set(ALL_LINKS.map((item) => item.id));

function docsSectionFromHash(source = window.location.hash): string | null {
  const parts = source.replace(/^#\/?/, "").split("/").filter(Boolean);
  const section = parts[0] === "docs" ? parts[1] : undefined;
  return section && SECTION_IDS.has(section) ? section : null;
}

const partnerById = new Map(ECOSYSTEM_PARTNERS.map((partner) => [partner.id, partner]));
const pilotById = new Map(PILOT_WORKSPACES.map((pilot) => [pilot.id, pilot]));

const DOC_INTEGRATIONS = [
  {
    id: "pollar",
    mode: "ReceiptOnly · Testnet",
    useCase: "Wallet-signed private proposals",
    implemented: "The published adapter converts Pollar signTx and signAuthEntry responses into SDK-compatible callbacks and has live Testnet transaction and authorization-entry evidence.",
    responsibility: "Pollar owns authentication, wallet provisioning, and user approval. Sub Rosa does not modify Pollar's core product.",
    sourceKey: "primaryLink" as const,
    referenceKey: "secondaryLink" as const,
  },
  {
    id: "cosmos-pay",
    mode: "ReceiptOnly",
    useCase: "Private merchant RFQs",
    implemented: "The signed official community plugin binds canonical RFQ data to a reviewed Sub Rosa deployment, accepts client-verified receipt evidence, and links the selected provider's Stellar payment intent.",
    responsibility: "The companion client verifies the ledger receipt; Cosmos Pay owns provider payment and settlement. The plugin has no network egress.",
    sourceKey: "primaryLink" as const,
    referenceKey: "secondaryLink" as const,
  },
  {
    id: "proofwork",
    mode: "ReceiptOnly · Testnet",
    useCase: "Fixed-pair sealed assessments",
    implemented: "The merged optional workflow fixes the reviewers to the founder wallet and original campaign creator, records two independent commits, reveals them together, and requires a verified receipt before the founder's final decision.",
    responsibility: "Proofwork keeps final-decision authority and separates the creator from the Trustless Work release signer. No fresh live Trustless Work payout cycle is claimed.",
    sourceKey: "primaryLink" as const,
    referenceKey: "secondaryLink" as const,
  },
  {
    id: "offer-hub",
    mode: "ReceiptOnly · Testnet",
    useCase: "Sealed freelancer proposals",
    implemented: "The integration is merged to OFFER HUB's development branch and has a partner-hosted Testnet deployment; Sub Rosa also maintains a separate hosted pilot.",
    responsibility: "OFFER HUB retains discovery, profiles, eligibility, provider selection, and payment. This is not a production marketplace launch.",
    sourceKey: "secondaryLink" as const,
    demoKey: "primaryLink" as const,
    pilotId: "offer-hub",
  },
  {
    id: "stelhacks",
    mode: "Tlock payload sealing",
    useCase: "Deadline-bound judging",
    implemented: "Partner-owned code derives the first Drand round at or after the frozen judging deadline and seals the full judging payload so the collection service cannot choose an earlier reveal.",
    responsibility: "StelHacks owns deadline provenance, collection, judging, and downstream decisions; this evidence demonstrates payload sealing rather than a Core v2 settlement round.",
    sourceKey: "primaryLink" as const,
  },
  {
    id: "trustless-work",
    mode: "ReceiptOnly · Escrow handoff",
    useCase: "Proposal selection before escrow",
    implemented: "The hosted Testnet pilot seals proposals, verifies the selected result, and prepares a Trustless Work multi-release escrow handoff.",
    responsibility: "ReceiptOnly never custodies funds. Trustless Work owns escrow creation, funding, milestones, authorization, and payment execution.",
    sourceKey: "primaryLink" as const,
    pilotId: "trustless-work",
  },
  {
    id: "acta",
    mode: "ReceiptOnly · Credential gate",
    useCase: "Credential-qualified submissions",
    implemented: "The hosted pilot validates credential status, type, issuer, and holder before an application-level submission gate and can issue an outcome credential after selection.",
    responsibility: "ACTA supplies credential semantics; the organizer still makes the business decision. The workspace is a credential-gated pilot, not a production partner deployment.",
    sourceKey: "secondaryLink" as const,
    pilotId: "acta",
  },
  {
    id: "the-signal",
    mode: "ReceiptOnly",
    useCase: "Sealed OTC and loan offers",
    implemented: "A standalone Sub Rosa-hosted workspace demonstrates timed offer reveal and organizer selection without requiring access to The Signal's production systems.",
    responsibility: "The organizer selects the offer and owns downstream deal execution; no production integration is claimed.",
    sourceKey: "primaryLink" as const,
    pilotId: "the-signal",
  },
  {
    id: "openx402",
    mode: "ReceiptOnly · Experimental",
    useCase: "Resource-bound agent competition",
    implemented: "The hosted workspace seals quotes against fixture-backed resource digests and stops at a typed payment handoff after verified reveal.",
    responsibility: "The agent application validates its cap and chooses the quote. No x402 payment is executed and Sub Rosa records no economic winner.",
    sourceKey: "secondaryLink" as const,
    pilotId: "openx402",
  },
] as const;

const installCode = `mkdir sub-rosa-receipt-quickstart
cd sub-rosa-receipt-quickstart
npm init -y
npm install @sub-rosa/sdk@${SDK_VERSION} @stellar/stellar-sdk@15.1.0`;

const repositoryQuickstartCode = `corepack enable
pnpm install
cp examples/receipt-only-quickstart/.env.example examples/receipt-only-quickstart/.env
pnpm quickstart:keypair
# Fund the printed G... address with the printed Friendbot URL, then set .env.
pnpm quickstart:check   # offline: typecheck + unit tests, no Drand wait
pnpm quickstart:live    # optional: real Stellar Testnet lifecycle`;

const clientCode = `import { SubRosaClient } from "@sub-rosa/sdk";

const client = new SubRosaClient({
  network: "testnet", // use "mainnet" for the production network
  secretKey: process.env.STELLAR_SECRET_KEY,
});`;

const auctionCreateCode = `import { createHash } from "node:crypto";
import {
  createAssetAuctionRound,
  generateAuditorKeypair,
  quicknet,
  roundInSeconds,
  SubRosaClient,
} from "@sub-rosa/sdk";

const drand = quicknet();
const chain = await drand.chain().info();
const revealRound = await roundInSeconds(drand, 5 * 60);
const revealAt = Number(chain.genesis_time) + Number(chain.period) * (revealRound - 1);
const auditor = generateAuditorKeypair();

const roundId = await createAssetAuctionRound(sellerClient, {
  itemRef: createHash("sha256").update("marketplace:item:4821").digest(),
  paymentAsset: usdcSac,
  lotAsset: collectibleSac,
  lotAmount: 1n,
  fixedEscrow: 1_000_000_000n,
  revealRound,
  commitDeadline: revealAt - 15,
  revealDeadline: revealAt + 300,
  auditorPubkey: auditor.publicKey,
  maxParticipants: 10,
  eligibleParticipants: collectorAddresses, // omit for an open round
});`;

const auctionBidCode = `import { quicknet, sealAssetBid, SubRosaClient } from "@sub-rosa/sdk";

const bidderClient = new SubRosaClient({
  network: "testnet",
  secretKey: process.env.BIDDER_SECRET,
});

// round and roundId come from the seller-created round above.
const sealed = await sealAssetBid({
  round: Number(round.reveal_round),
  drand: quicknet(),
  amount: 700_000_000n,
  payload: new TextEncoder().encode(JSON.stringify({
    currency: "USDC",
    termsVersion: 1,
  })),
});

await bidderClient.submitV2({
  roundId,
  sealed,
  escrow: 1_000_000_000n, // must equal the round's fixedEscrow
});`;

const proposalCode = `import {
  createSealedProposalRound,
  sealProposal,
} from "@sub-rosa/sdk";

const roundId = await createSealedProposalRound(organizerClient, {
  itemRef,
  revealRound,
  commitDeadline,
  revealDeadline,
  auditorPubkey: auditor.publicKey,
  maxParticipants: 12,
  eligibleParticipants: providerAddresses,
});

const sealed = await sealProposal({
  round: Number(revealRound),
  drand,
  price: 25_000_000_000n,
  proposal: {
    timelineDays: 14,
    approach: "Manual review, fuzzing, and remediation report",
    metadata: { teamSize: "3", region: "EU" },
  },
});

await providerClient.submitV2({ roundId, sealed, escrow: 0n });`;

const browserInstallCode = `npm install @sub-rosa/sdk @stellar/freighter-api@6.0.1`;

const browserCode = `import {
  getNetworkDetails,
  isConnected,
  requestAccess,
  signAuthEntry,
  signTransaction,
} from "@stellar/freighter-api";
import { SubRosaClient } from "@sub-rosa/sdk";

const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";
const installed = await isConnected();
if (installed.error || !installed.isConnected) {
  throw new Error("Install and unlock Freighter before connecting.");
}

const access = await requestAccess(); // explicit user approval
if (access.error || !access.address) {
  throw new Error(JSON.stringify(access.error ?? "Wallet access rejected"));
}
const network = await getNetworkDetails();
if (network.error || network.networkPassphrase !== TESTNET_PASSPHRASE) {
  throw new Error("Switch Freighter to Testnet, then reconnect.");
}

const client = new SubRosaClient({
  network: "testnet",
  publicKey: access.address,
  signTransaction: async (xdr, options) => {
    const result = await signTransaction(xdr, {
      networkPassphrase: options?.networkPassphrase ?? TESTNET_PASSPHRASE,
      address: options?.address ?? access.address,
    });
    if (result.error) throw new Error(JSON.stringify(result.error));
    return {
      signedTxXdr: result.signedTxXdr,
      signerAddress: result.signerAddress,
    };
  },
  signAuthEntry: async (entryXdr, options) => {
    const result = await signAuthEntry(entryXdr, {
      networkPassphrase: options?.networkPassphrase ?? TESTNET_PASSPHRASE,
      address: options?.address ?? access.address,
    });
    if (result.error || !result.signedAuthEntry) {
      throw new Error(JSON.stringify(result.error ?? "No signed auth entry"));
    }
    return {
      signedAuthEntry: result.signedAuthEntry,
      signerAddress: result.signerAddress,
    };
  },
});`;

const lifecycleCode = `import { fetchRoundSignature, openPayload } from "@sub-rosa/sdk";

const signature = await fetchRoundSignature(drand, Number(round.reveal_round));
await keeperClient.openRevealV2(roundId, signature);

for (const bidder of await keeperClient.getBiddersV2(roundId)) {
  const state = await keeperClient.getSubmissionV2(roundId, bidder);
  if (state.revealed_envelope) continue; // retry-safe

  const seal = await keeperClient.getSealV2(roundId, bidder);
  if (!seal) continue;
  const envelope = await openPayload(seal.ciphertext, drand);
  await keeperClient.revealV2({ roundId, bidder, envelope });
}

// Call only after revealDeadline.
await keeperClient.clearV2(roundId);
const finalRound = await keeperClient.getRoundV2(roundId);
if (finalRound.status.tag === "Cleared" && finalRound.mode.tag === "Auction") {
  await keeperClient.settleV2(roundId);
}`;

// Step 1 — detect the policy capability, then create the round.
const ownerRevealCode = `import {
  drandRoundTime,
  quicknet,
  resolveRevealPolicyV3Deployment,
  SubRosaClient,
} from "@sub-rosa/sdk";

// Explicit opt-in: the SDK/UI defaults still resolve to the reviewed
// Core v2 contract. Protocol 3 is reached only by its own contract id.
const v3 = resolveRevealPolicyV3Deployment("testnet");
const operator = new SubRosaClient({
  rpcUrl: v3.rpcUrl,
  networkPassphrase: v3.networkPassphrase,
  contractId: v3.contractId,
  secretKey: process.env.OPERATOR_SECRET,
});

// A Core v2 contract has no reveal policy. Probe capability 3 first so you
// fail fast instead of hitting a missing contract function at runtime.
if (!(await operator.supportsRevealPolicy())) {
  throw new Error("Target contract is Core v2 (Timed reveal only).");
}

// fallbackAt must be AFTER Drand R, and revealDeadline must be at least
// fallbackAt + 300s. Otherwise create_round_v3 reverts with error 46
// (InvalidRevealPolicy); the SDK also rejects it client-side first.
const revealAt = drandRoundTime(
  Number(auctionParams.revealRound),
  await quicknet().chain().info(),
);
const roundId = await operator.createRoundV3({
  ...auctionParams, // same item / schema / mode / deadline fields as Core v2
  revealPolicy: { type: "owner-triggered", fallbackAt: revealAt + 300 },
  revealDeadline: revealAt + 900,
});`;

// Step 2 — manual reveal by the operator, or the permissionless fallback,
// then the identical Core v2 reveal -> clear -> settle flow.
const ownerRevealLifecycleCode = `import {
  fetchRoundSignature,
  openPayload,
  quicknet,
} from "@sub-rosa/sdk";

// The policy is immutable and readable at any time. Rounds created before
// protocol 3 have none, so getRevealStateV3 throws error 47
// (RevealPolicyMissing) for a plain Core v2 round.
const state = await operator.getRevealStateV3(roundId);
// state.policy -> { tag: "OwnerTriggered", values: [fallbackAt] }
// state.opened_at -> undefined until reveal is opened, then the open time.

// Once Drand publishes round R, fetch the BLS signature once.
const signature = await fetchRoundSignature(quicknet(), Number(revealRound));

// MANUAL REVEAL — before fallbackAt only the immutable operator may open.
// A non-operator calling this before fallbackAt fails require_auth (a host
// auth error, not a numbered contract code). openRevealV2 still verifies the
// Drand signature, so opening early is impossible for everyone.
await operator.openRevealV2(roundId, signature);

// PERMISSIONLESS FALLBACK — if the operator stays silent, ANY funded account
// may open at or after fallbackAt. A silent operator can never freeze escrow
// or the lot; the round always makes progress.
// await anyone.openRevealV2(roundId, signature);

// From here the flow is the Core v2 flow. Read and open each envelope
// separately so one missing or malformed ciphertext cannot fail the group.
for (const bidder of await operator.getBiddersV2(roundId)) {
  const seal = await operator.getSealV2(roundId, bidder);
  if (!seal) continue;
  const envelope = await openPayload(seal.ciphertext, quicknet());
  await operator.revealV2({ roundId, bidder, envelope });
}

const winner = await operator.clearV2(roundId); // deterministic winner or undefined
if (winner) {
  await operator.settleV2(roundId); // Auction mode only; ReceiptOnly stops at Cleared
}

// RECOVERY — if reveal stalls past revealDeadline + 3600s, anyone may void:
// void_v2 refunds every escrow and returns the lot. No funds can be stranded.
// await anyone.voidV2(roundId);`;

const receiptCode = `import {
  serializeReceiptV2,
  SubRosaClient,
  verifyReceiptV2,
} from "@sub-rosa/sdk";

const reader = new SubRosaClient({ network: "testnet" });
const receipt = await reader.exportReceiptV2(roundId);
const verification = verifyReceiptV2(receipt);

if (!verification.valid) {
  throw new Error(JSON.stringify(verification.issues));
}

const canonicalJson = serializeReceiptV2(receipt);
console.log(verification.computedWinner);
// Store canonicalJson in your audit log or return it from your API.`;

const preflightCode = `// params is a complete CreatePartnerRoundV2Params object for the selected mode.
const check = await client.preflightCreatePartnerRoundV2(params);

if (!check.ok) {
  console.error({
    kind: check.error.kind,
    code: check.error.contractErrorCode,
    message: check.error.message,
    fee: check.fee,
    resources: check.resources,
  });
  return;
}

const roundId = await client.createPartnerRoundV2(params);`;

const API_ROWS = [
  ["createAssetAuctionRound", "Create a policy-enforced Auction and custody the lot", "Promise<bigint>"],
  ["createSealedProposalRound", "Create a zero-escrow ReceiptOnly round", "Promise<bigint>"],
  ["createRoundV3", "Create a round with a reveal policy (protocol 3, opt-in)", "Promise<bigint>"],
  ["supportsRevealPolicy", "Probe whether the contract advertises capability 3", "Promise<boolean>"],
  ["getRevealStateV3", "Read the immutable reveal policy and opened timestamp", "Promise<RevealStateV3>"],
  ["sealAssetBid", "Encrypt and commit an amount plus optional payload to Drand R", "Promise<SealedPayload>"],
  ["sealProposal", "Encode and encrypt price, timeline, approach, and metadata", "Promise<SealedPayload>"],
  ["submitV2 / commitV2", "Authorize escrow and store the sealed submission", "Promise<void>"],
  ["openRevealV2", "Verify the Drand BLS signature and open reveal", "Promise<void>"],
  ["revealV2", "Persist one canonical decrypted envelope", "Promise<void>"],
  ["clearV2", "Compute the deterministic winner or finalize ReceiptOnly", "Promise<string | undefined>"],
  ["settleV2", "Atomically pay seller, transfer lot, and refund surplus", "Promise<void>"],
  ["voidV2", "Recover escrow and lot after the protocol grace path", "Promise<void>"],
  ["getRoundV2", "Read durable round configuration and status", "Promise<RoundV2>"],
  ["getRoundPolicyV2", "Read fixed escrow and participant eligibility", "Promise<RoundPolicyV2 | undefined>"],
  ["getSubmissionV2", "Read one durable submission state", "Promise<SubmissionStateV2>"],
  ["getBiddersV2", "Read the ordered, bounded participant set", "Promise<string[]>"],
  ["getSealV2", "Read temporary ciphertext and auditor evidence", "Promise<Seal | undefined>"],
  ["exportReceiptV2", "Export the complete canonical Core v2 receipt", "Promise<CoreV2Receipt>"],
];

const ERROR_ROWS = [
  ["1", "NotInitialized", "Wrong or unconfigured contract", "Verify contract ID and deployment finality"],
  ["2", "AlreadyInitialized", "Contract configuration already exists", "Do not redeploy; read getConfig instead"],
  ["3", "RoundNotFound", "Round ID is absent on this contract", "Check network, contract ID, and round ID together"],
  ["4", "BidNotFound", "No submission exists for this bidder and round", "Confirm bidder, round, and commit transaction"],
  ["10", "CommitClosed", "Commit deadline passed", "Create a new round; do not retry this commit"],
  ["11", "CommitNotClosed", "Reveal attempted too early", "Retry after commitDeadline"],
  ["12", "CommitDeadlineAfterReveal", "Deadlines do not bracket Drand R", "Use commitDeadline < time(R) < revealDeadline"],
  ["13", "RevealNotOpen", "Reveal gate has not opened", "Call openRevealV2 with the real round-R signature"],
  ["14", "RevealAlreadyOpen", "Another caller opened reveal", "Treat as success and continue revealing"],
  ["15", "RevealWindowClosed", "Envelope arrived after revealDeadline", "Clear or follow the void path"],
  ["16", "RevealStillOpen", "Clear called before revealDeadline", "Retry after ledger time passes the deadline"],
  ["17", "NotCleared", "Settlement called before clear", "Call clearV2 first"],
  ["18", "AlreadyCleared", "Round winner or ReceiptOnly result is already fixed", "Do not retry clear; settle an Auction winner if needed"],
  ["19", "AlreadySettled", "Terminal round was submitted again", "Treat as terminal; do not retry"],
  ["20", "RoundVoided", "Round is terminal and refunded", "Start a new round if needed"],
  ["21", "NotVoidable", "Grace period or state does not allow void", "Complete normally or wait for the grace boundary"],
  ["22", "WrongStatus", "Mutation does not match lifecycle state", "Read getRoundV2 and choose the next valid action"],
  ["30", "InvalidDrandSignature", "Wrong or guessed beacon signature", "Fetch from the official quicknet endpoint"],
  ["31", "HashMismatch", "Reveal differs from committed plaintext", "Submit the exact envelope opened from ciphertext"],
  ["32", "AlreadyRevealed", "Another caller revealed this bidder", "Treat as success and continue the cohort"],
  ["33", "PayloadTooLarge", "Ciphertext or auditor blob exceeds limits", "Keep ciphertext <= 4096 B and auditor blob <= 2048 B"],
  ["34", "InvalidAmount", "Missing asset, lot, or positive amount", "Validate Auction settlement inputs"],
  ["35", "BidExceedsEscrow", "Revealed amount exceeds locked escrow", "Use a bid at or below fixed escrow"],
  ["36", "DeadlineInPast", "Commit deadline is not in the future", "Recalculate from current ledger time"],
  ["37", "NoValidBids", "Cleared state unexpectedly has no winner", "Normal no-bid flow voids; treat this as inconsistent state and review"],
  ["38", "RoundFull", "Participant cap reached", "Create another round"],
  ["39", "InvalidLimit", "Bidder page size is outside 1-100", "Use a page limit in [1, 100] and follow next_cursor"],
  ["40", "UnsupportedVersion", "Protocol or envelope version mismatch", "Use payload envelope v1 or a deployment supporting that protocol"],
  ["41", "MalformedPayload", "Envelope is not canonical", "Use SDK seal/open helpers without editing bytes"],
  ["42", "EscrowNotAllowed", "ReceiptOnly received assets or escrow", "Submit exactly zero escrow"],
  ["43", "RoundDurationTooLong", "Round exceeds 30 days", "Shorten deadlines"],
  ["44", "ParticipantNotEligible", "Wallet is not allowlisted", "Use an eligible wallet or recreate the policy"],
  ["45", "EscrowPolicyMismatch", "Auction escrow differs from fixed policy", "Read policy and submit exact fixed_escrow"],
  ["46", "InvalidRevealPolicy", "Protocol 3 fallback window is invalid", "Place fallback after Drand R and leave at least 300s before deadline"],
  ["47", "RevealPolicyMissing", "Required Protocol 3 policy state is absent", "Fail closed; never infer permissionless opening from missing state"],
];

function CodeBlock({
  code,
  label = "TypeScript",
  status = "Illustrative",
  sourceHref,
}: {
  code: string;
  label?: string;
  status?: "Executable" | "Illustrative" | "Repository command";
  sourceHref?: string;
}) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
    window.setTimeout(() => setCopyState("idle"), 1800);
  }

  return (
    <div className="docs-code">
      <div className="docs-code-head">
        <span>{label}<em>{status}</em></span>
        {sourceHref && <a href={sourceHref} target="_blank" rel="noreferrer">View complete source<ExternalLink size={12} /></a>}
        <button type="button" onClick={copy} aria-label={`Copy ${label} code`} title="Copy code">
          {copyState === "copied" ? <Check size={15} /> : <Clipboard size={15} />}
          {copyState === "copied" ? "Copied" : copyState === "error" ? "Copy failed" : "Copy"}
        </button>
      </div>
      <pre><code>{code}</code></pre>
    </div>
  );
}

function SectionHeading({ eyebrow, title, children }: { eyebrow: string; title: string; children: string }) {
  return (
    <header className="docs-section-heading">
      <span>{eyebrow}</span>
      <h2>{title}</h2>
      <p>{children}</p>
    </header>
  );
}

function Callout({ title, children, tone = "info" }: { title: string; children: React.ReactNode; tone?: "info" | "warning" | "success" }) {
  return (
    <aside className={`docs-callout ${tone}`}>
      {tone === "success" ? <CheckCircle2 size={18} /> : tone === "warning" ? <ShieldCheck size={18} /> : <BookOpen size={18} />}
      <div><strong>{title}</strong><p>{children}</p></div>
    </aside>
  );
}

const SEARCH_EXTRAS: Record<string, string> = {
  overview: "confidential proposals escrow auctions Drand Soroban settlement receipts public package live contracts",
  quickstart: "Node.js project initialization environment STELLAR_SECRET_KEY account funding Friendbot create seal submit wait open reveal clear receipt expected output troubleshooting",
  "choose-mode": "Auction ReceiptOnly atomic exchange zero escrow proposals procurement RFP",
  network: "Stellar mainnet testnet RPC contract WASM fee signer deployment",
  auction: "SAC lot payment asset fixed escrow highest bid seller bidder custody settlement",
  proposal: "price timeline approach metadata public after reveal off-chain selection",
  "browser-wallets": "install connect network switch user reject transaction authorization entry private key",
  integrations: DOC_INTEGRATIONS.map((entry) => `${entry.id} ${entry.mode} ${entry.useCase} ${entry.implemented}`).join(" "),
  timing: "genesis_time period revealRound commitDeadline revealDeadline 30 days 25 participants",
  lifecycle: "keeper Open Revealing Cleared Settled Voided retry AlreadyRevealed RevealAlreadyOpen",
  "owner-reveal": "Protocol 3 manual operator fallbackAt require_auth InvalidRevealPolicy RevealPolicyMissing",
  policies: "fixed escrow eligibility allowlist bounded cohort maxParticipants",
  receipts: "canonical JSON offline verify network fingerprint SHA-256 winner settlement provenance",
  "read-api": "read-only simulation durable temporary storage ciphertext auditor blob",
  preflight: "typed contract errors fee resources HostError wallet action",
  "api-reference": API_ROWS.flat().join(" "),
  errors: ERROR_ROWS.flat().join(" "),
  security: "on-chain operational responsibility audit KYC keeper keys caps trust threat",
  deployment: "production checklist tests monitor incident response migrations compatibility",
};

export function DocsPage({ goHome }: { goHome: () => void }) {
  const [query, setQuery] = useState("");
  const [mobileNav, setMobileNav] = useState(false);
  const [activeSection, setActiveSection] = useState(() => docsSectionFromHash() ?? "overview");
  const [activeSearchResult, setActiveSearchResult] = useState(0);
  const mobileMenuRef = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const matches = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return [];
    return ALL_LINKS.filter((item) =>
      `${item.label} ${item.keywords} ${SEARCH_EXTRAS[item.id] ?? ""}`.toLowerCase().includes(normalized),
    );
  }, [query]);

  useEffect(() => setActiveSearchResult(0), [query]);

  useEffect(() => {
    const sections = ALL_LINKS
      .map((item) => document.getElementById(item.id))
      .filter((section): section is HTMLElement => Boolean(section));
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((left, right) => left.boundingClientRect.top - right.boundingClientRect.top)[0];
        if (visible) setActiveSection(visible.target.id);
      },
      { rootMargin: "-18% 0px -68%", threshold: [0, 0.05] },
    );
    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const openHashSection = () => {
      const section = docsSectionFromHash();
      if (!section) return;
      setActiveSection(section);
      window.requestAnimationFrame(() => {
        document.getElementById(section)?.scrollIntoView({ block: "start" });
      });
    };
    openHashSection();
    window.addEventListener("hashchange", openHashSection);
    window.addEventListener("popstate", openHashSection);
    return () => {
      window.removeEventListener("hashchange", openHashSection);
      window.removeEventListener("popstate", openHashSection);
    };
  }, []);

  useEffect(() => {
    if (!mobileNav) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const firstButton = sidebarRef.current?.querySelector<HTMLButtonElement>(".docs-nav-group button");
    window.requestAnimationFrame(() => firstButton?.focus());
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMobileNav(false);
      mobileMenuRef.current?.focus();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [mobileNav]);

  function jump(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    if (window.location.hash !== `#/docs/${id}`) {
      window.history.pushState(null, "", `#/docs/${id}`);
    }
    setActiveSection(id);
    setQuery("");
    setMobileNav(false);
  }

  function searchKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setQuery("");
      return;
    }
    if (!matches.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveSearchResult((value) => (value + 1) % matches.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveSearchResult((value) => (value - 1 + matches.length) % matches.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const match = matches[activeSearchResult];
      if (match) jump(match.id);
    }
  }

  return (
    <main className="docs-page">
      <nav className="docs-topbar">
        <button type="button" className="brand-link" onClick={goHome}>
          <img src={LOGO_SRC} alt="" />
          <span>Sub Rosa</span>
          <em>Docs</em>
        </button>
        <div className="docs-search-wrap">
          <Search size={17} aria-hidden="true" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={searchKeyDown}
            placeholder="Search documentation"
            aria-label="Search documentation"
            aria-expanded={Boolean(query)}
            aria-controls="docs-search-results"
            aria-activedescendant={query && matches[activeSearchResult] ? `docs-search-${matches[activeSearchResult].id}` : undefined}
          />
          {query && <button type="button" onClick={() => setQuery("")} aria-label="Clear search"><X size={15} /></button>}
          {query && (
            <div className="docs-search-results" id="docs-search-results" role="listbox" aria-label="Documentation sections">
              {matches.length ? matches.map((item, index) => (
                <button
                  type="button"
                  role="option"
                  aria-selected={index === activeSearchResult}
                  className={index === activeSearchResult ? "active" : ""}
                  id={`docs-search-${item.id}`}
                  key={item.id}
                  onMouseEnter={() => setActiveSearchResult(index)}
                  onClick={() => jump(item.id)}
                >
                  <Search size={14} /><span>{item.label}</span><ArrowRight size={14} />
                </button>
              )) : <p>No matching section</p>}
            </div>
          )}
        </div>
        <div className="docs-top-actions">
          <span className="docs-version">SDK v{SDK_VERSION}</span>
          <a href="https://github.com/karagozemin/Sub-Rosa" target="_blank" rel="noreferrer"><Code2 size={17} />GitHub</a>
          <a href="#/pilot" target="_blank" rel="noreferrer" className="docs-pilot-link">Open pilot<ArrowRight size={16} /></a>
          <button
            ref={mobileMenuRef}
            type="button"
            className="docs-mobile-menu"
            onClick={() => setMobileNav((value) => !value)}
            aria-label="Toggle documentation navigation"
            aria-controls="docs-sidebar"
            aria-expanded={mobileNav}
          >
            {mobileNav ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </nav>

      <div className="docs-shell">
        {mobileNav && <button type="button" className="docs-sidebar-backdrop" onClick={() => setMobileNav(false)} aria-label="Close documentation navigation" />}
        <aside ref={sidebarRef} id="docs-sidebar" aria-label="Documentation navigation" className={`docs-sidebar ${mobileNav ? "open" : ""}`}>
          <div className="docs-sidebar-scroll">
            {NAV_GROUPS.map((group) => (
              <div className="docs-nav-group" key={group.label}>
                <strong>{group.label}</strong>
                {group.items.map((item) => <button type="button" className={activeSection === item.id ? "active" : ""} aria-current={activeSection === item.id ? "location" : undefined} key={item.id} onClick={() => jump(item.id)}>{item.label}</button>)}
              </div>
            ))}
          </div>
          <div className="docs-sidebar-foot">
            <span>Mainnet Core v2</span>
            <code>{MAINNET_DEPLOYMENT.contractId.slice(0, 9)}...{MAINNET_DEPLOYMENT.contractId.slice(-7)}</code>
            <a href={`https://stellar.expert/explorer/public/contract/${MAINNET_DEPLOYMENT.contractId}`} target="_blank" rel="noreferrer">View on explorer<ExternalLink size={13} /></a>
          </div>
        </aside>

        <article className="docs-content">
          <section className="docs-intro" id="overview">
            <div className="docs-breadcrumb"><span>Documentation</span><span>/</span><span>Core v2</span></div>
            <h1>Build sealed rounds on Stellar.</h1>
            <p className="docs-intro-lede">Integrate confidential proposals or escrow-backed asset auctions with Drand-timed reveal, Soroban settlement, and receipts anyone can verify.</p>
            <div className="docs-intro-actions">
              <button type="button" onClick={() => jump("quickstart")}><Terminal size={17} />Start integrating</button>
              <button type="button" onClick={() => jump("auction")}><Code2 size={17} />Auction guide</button>
              <a href="#/pilot/the-signal"><ShieldCheck size={17} />Try deal-flow pilot</a>
            </div>
            <div className="docs-proof-strip">
              <div><Package size={18} /><span>Public package</span><strong>@sub-rosa/sdk@{SDK_VERSION}</strong></div>
              <div><Server size={18} /><span>Live contracts</span><strong>Core v2 mainnet + testnet</strong></div>
              <div><FileCheck2 size={18} /><span>Live proofs</span><strong>Testnet rounds #2 and #3</strong></div>
            </div>
          </section>

          <section className="docs-section" id="quickstart">
            <SectionHeading eyebrow="Start" title="ReceiptOnly Testnet quickstart">Run one real zero-escrow proposal from creation through canonical receipt verification. The repository example is type-checked and unit-tested offline; its live command separately waits for Stellar Testnet and Drand.</SectionHeading>
            <Callout title="Prerequisites">Use Node.js 22 or newer, Corepack/pnpm 10.13.1, internet access to Stellar Testnet RPC and Drand quicknet, and one disposable funded Testnet account. Never place its secret key in frontend code or reuse a mainnet key.</Callout>
            <div className="docs-step"><span>1</span><div><h3>Install the published SDK</h3><p>For a standalone Node project, install the verified SDK and Stellar SDK versions. `@sub-rosa/sdk` brings compatible tlock and contract bindings.</p></div></div>
            <CodeBlock code={installCode} label="Terminal" status="Executable" />
            <div className="docs-step"><span>2</span><div><h3>Create and fund a Testnet signer</h3><p>The runnable repository example can generate a disposable keypair. Put only `STELLAR_SECRET_KEY=S...` in `examples/receipt-only-quickstart/.env`, then open the printed Friendbot URL to create and fund its `G...` account.</p></div></div>
            <CodeBlock
              code={repositoryQuickstartCode}
              label="Terminal"
              status="Repository command"
              sourceHref="https://github.com/karagozemin/Sub-Rosa/tree/main/examples/receipt-only-quickstart"
            />
            <div className="docs-step"><span>3</span><div><h3>Connect the named Testnet deployment</h3><p>The minimal runner uses one wallet as organizer, sole eligible participant, and lifecycle caller. That keeps setup small; production integrations may separate those roles.</p></div></div>
            <CodeBlock code={clientCode} status="Executable" />
            <div className="docs-step"><span>4</span><div><h3>Run the complete lifecycle</h3><p>The checked source calculates Drand R with `roundInSeconds`, creates a real ReceiptOnly round, seals and submits one proposal with zero escrow, waits for R, opens and reveals, waits for the reveal deadline, clears, exports, serializes, and verifies the receipt.</p></div></div>
            <div className="docs-checklist compact">
              {["createSealedProposalRound with an allowlisted Testnet signer", "sealProposal and submitV2 with escrow: 0n", "fetchRoundSignature, openRevealV2, openPayload, and revealV2", "preflightClearV2 retry for Stellar ledger-time catch-up", "exportReceiptV2, verifyReceiptV2, and canonical serialization", "Real client.submittedTransactionHashes mapped to Stellar Expert"].map((item) => <div key={item}><CheckCircle2 size={18} /><span>{item}</span></div>)}
            </div>
            <div className="docs-contract-note"><Terminal size={19} /><div><strong>Expected live output</strong><p>The final lines are `RECEIPT_ONLY_QUICKSTART_PASSED` and JSON containing the real contract ID, round ID, `ReceiptOnly`, terminal status, `receiptVerified: true`, and explorer URLs for create, commit, open, reveal, and clear. No transaction hash is hardcoded or presented as evidence.</p></div></div>
            <Callout title="Common failures" tone="warning">Fund the generated account before running. Error 10 means the commit window closed and requires a fresh round; a Drand 425 means R is not published yet; error 16 means ledger time has not crossed the reveal deadline and the example retries. After an RPC timeout, inspect recorded hashes before repeating a write.</Callout>
            <Callout title="Use stroops, not display decimals">All contract amounts are integer `bigint` values in the asset's smallest unit. A 7-decimal Stellar asset represents 100 units as `1_000_000_000n`.</Callout>
          </section>

          <section className="docs-section" id="choose-mode">
            <SectionHeading eyebrow="Model" title="Choose the right mode">Both modes share the same encryption, Drand gate, bounded participant set, permissionless lifecycle, and receipt format.</SectionHeading>
            <div className="docs-mode-grid">
              <div><span>Auction</span><h3>Atomic asset exchange</h3><p>For collectibles, game assets, access rights, allocations, and other lots that must move with payment.</p><ul><li>Seller deposits a SAC lot at creation</li><li>Every bidder locks identical fixed escrow</li><li>Highest valid bid wins by default</li><li>Payment and lot move in settlement</li></ul><button type="button" onClick={() => jump("auction")}>Build an auction<ArrowRight size={15} /></button></div>
              <div><span>ReceiptOnly</span><h3>Confidential proposal proof</h3><p>For procurement, RFPs, audits, and competitive proposals where asset settlement stays in the partner product.</p><ul><li>No payment or lot assets</li><li>Every submission uses zero escrow</li><li>Price and structured terms reveal after R</li><li>Completion produces a canonical receipt</li></ul><button type="button" onClick={() => jump("proposal")}>Build a proposal round<ArrowRight size={15} /></button></div>
            </div>
          </section>

          <section className="docs-section" id="network">
            <SectionHeading eyebrow="Configuration" title="Network and contract">Pin all three values together. A Stellar contract address does not identify which network it belongs to.</SectionHeading>
            <div className="docs-mode-grid">
              <div>
                <span>Stellar Mainnet</span>
                <h3>Canonical Core v2</h3>
                <div className="docs-kv-table">
                  <div><span>RPC</span><code>{MAINNET_DEPLOYMENT.rpcUrl}</code></div>
                  <div><span>Contract</span><code>{MAINNET_DEPLOYMENT.contractId}</code></div>
                  <div><span>WASM SHA-256</span><code>{WASM_HASH}</code></div>
                </div>
                <a href={`https://stellar.expert/explorer/public/contract/${MAINNET_DEPLOYMENT.contractId}`} target="_blank" rel="noreferrer">View mainnet contract<ExternalLink size={13} /></a>
              </div>
              <div>
                <span>Stellar Testnet</span>
                <h3>Live proof deployment</h3>
                <div className="docs-kv-table">
                  <div><span>RPC</span><code>{TESTNET_DEPLOYMENT.rpcUrl}</code></div>
                  <div><span>Contract</span><code>{CONTRACT_ID}</code></div>
                  <div><span>WASM SHA-256</span><code>{WASM_HASH}</code></div>
                </div>
                <a href={`https://stellar.expert/explorer/testnet/contract/${CONTRACT_ID}`} target="_blank" rel="noreferrer">View testnet contract<ExternalLink size={13} /></a>
              </div>
            </div>
            <Callout title="Funds-handling boundary" tone="warning">The contracts have public Testnet and capped Mainnet evidence, but no independent funds-handling audit. Do not attach uncapped Mainnet value without an independent review, explicit limits, and monitored recovery operations.</Callout>
            <p className="docs-copy">Use <code>network: "mainnet"</code> for the canonical Core v2 public-network deployment, or pass a reviewed contract override. The signer pays each transaction fee; Sub Rosa does not sponsor SDK writes by default.</p>
          </section>

          <section className="docs-section" id="auction">
            <SectionHeading eyebrow="Guide" title="Asset auction integration">The seller deposits the lot when creating the round. A bidder locks the shared escrow cap, then the contract exchanges winner payment and lot atomically.</SectionHeading>
            <h3>Create the round as seller</h3>
            <p className="docs-copy">This is an illustrative server-side fragment. `sellerClient` is a funded SDK client; `usdcSac` and `collectibleSac` are reviewed Stellar Asset Contract addresses; `collectorAddresses` is an optional `G...` allowlist. The seller must own `lotAmount` and authorize its transfer during creation.</p>
            <CodeBlock code={auctionCreateCode} status="Illustrative" sourceHref="https://github.com/karagozemin/Sub-Rosa/blob/main/services/auction-template/core-v2-auction.ts" />
            <h3>Seal and submit as bidder</h3>
            <p className="docs-copy">The amount and payload remain unreadable until Drand R. The fixed escrow is public, identical for every participant, and must cover the private bid.</p>
            <CodeBlock code={auctionBidCode} status="Illustrative" sourceHref="https://github.com/karagozemin/Sub-Rosa/blob/main/services/auction-template/core-v2-auction.ts" />
            <Callout title="SAC prerequisites" tone="warning">The seller needs the lot balance. Every bidder needs the payment asset trustline, balance, and authorization for the exact fixed escrow. Simulate before opening a wallet prompt.</Callout>
          </section>

          <section className="docs-section" id="proposal">
            <SectionHeading eyebrow="Guide" title="Sealed proposal integration">Collect private price, delivery timeline, approach, and partner metadata without moving assets in the first pilot.</SectionHeading>
            <p className="docs-copy">`organizerClient` and `providerClient` are funded server or wallet-backed SDK clients; `itemRef` is a 32-byte application binding; the deadlines must bracket Drand R. For a complete executable version, use the ReceiptOnly quickstart above.</p>
            <CodeBlock code={proposalCode} status="Illustrative" sourceHref="https://github.com/karagozemin/Sub-Rosa/tree/main/examples/receipt-only-quickstart" />
            <div className="docs-contract-note"><KeyRound size={19} /><div><strong>What becomes public?</strong><p>After Drand R, the price and proposal payload become public by design. Before R, only commitments, ciphertext, participant addresses, and policy metadata are public.</p></div></div>
            <Callout title="Partner selection remains off-chain">ReceiptOnly proves the submitted set, timing, commitment binding, and reveal result. Your marketplace still chooses the provider and owns the downstream engagement.</Callout>
          </section>

          <section className="docs-section" id="browser-wallets">
            <SectionHeading eyebrow="Frontend" title="Browser wallet signing">Connect explicitly, validate the wallet network before constructing the SDK, and pass transaction plus Soroban authorization-entry callbacks. A browser integration must never receive a secret key.</SectionHeading>
            <CodeBlock code={browserInstallCode} label="Terminal" status="Executable" />
            <CodeBlock code={browserCode} status="Illustrative" sourceHref="https://github.com/karagozemin/Sub-Rosa/blob/main/apps/web/src/lib/chain.ts" />
            <div className="docs-policy-list">
              <div><CheckCircle2 size={20} /><div><h3>Connect and validate</h3><p>Call `isConnected`, then `requestAccess`; treat its `error` as installation, lock, or user-rejection state. Read `getNetworkDetails` and require the exact expected passphrase. The 6.0.1 API does not switch networks for the user—ask them to switch in the wallet and reconnect.</p></div></div>
              <div><ShieldCheck size={20} /><div><h3>Sign both surfaces</h3><p>`signTransaction` approves the transaction envelope. `signAuthEntry` is separately required when Soroban authorization is not carried by the transaction source. Preserve `address` and `networkPassphrase` from the SDK callback options.</p></div></div>
              <div><KeyRound size={20} /><div><h3>Fail closed</h3><p>Do not retry a rejected signature automatically, fall back to a backend key, log signed XDR, or accept a different passphrase. Re-read the wallet address after an account change and rebuild the client.</p></div></div>
            </div>
            <Callout title="Common signing failures" tone="warning">An empty address means the wallet is locked or access was not granted. A passphrase mismatch requires a wallet network change. A missing `signedAuthEntry` must abort the call. After a transaction timeout, query its hash or account sequence before asking the user to sign again.</Callout>
            <p className="docs-copy">The generated `RoundContract` exposes spec-accurate snake_case methods such as `create_partner_round_v2` and `commit_v2`; `SubRosaClient` provides the camelCase partner surface. The <a href="https://www.npmjs.com/package/@sub-rosa/pollar-adapter/v/0.1.0" target="_blank" rel="noreferrer">Pollar adapter<ExternalLink size={13} /></a> is an additional tested reference for adapting both signing callback types.</p>
          </section>

          <section className="docs-section" id="integrations">
            <SectionHeading eyebrow="Evidence" title="Integrations and examples">Implementation status and links are sourced from the same ecosystem registry used by the landing page. A hosted workspace demonstrates a flow; it is not automatically a production partner deployment.</SectionHeading>
            <div className="docs-integration-list">
              {DOC_INTEGRATIONS.map((entry) => {
                const partner = partnerById.get(entry.id);
                if (!partner) return null;
                const source = partner[entry.sourceKey];
                const reference = "referenceKey" in entry ? partner[entry.referenceKey] : undefined;
                const demo = "demoKey" in entry ? partner[entry.demoKey] : undefined;
                const pilot = "pilotId" in entry ? pilotById.get(entry.pilotId) : undefined;
                return (
                  <article className="docs-integration-card" key={entry.id}>
                    <header><div><span>{entry.mode}</span><h3>{partner.name}</h3></div><em className={`tone-${partner.statusTone}`}>{partner.statusLabel}</em></header>
                    <strong>{entry.useCase}</strong>
                    <p><b>Implemented:</b> {entry.implemented}</p>
                    <p><b>Partner boundary:</b> {entry.responsibility}</p>
                    <div className="docs-integration-links">
                      {source && <a href={source.href} target={source.external ? "_blank" : undefined} rel={source.external ? "noreferrer" : undefined}>{source.label}<ExternalLink size={12} /></a>}
                      {reference && <a href={reference.href} target={reference.external ? "_blank" : undefined} rel={reference.external ? "noreferrer" : undefined}>{reference.label}<ExternalLink size={12} /></a>}
                      {demo && <a href={demo.href} target={demo.external ? "_blank" : undefined} rel={demo.external ? "noreferrer" : undefined}>{demo.label}<ExternalLink size={12} /></a>}
                      {pilot && <a href={pilot.href}>Open Sub Rosa pilot<ArrowRight size={12} /></a>}
                    </div>
                  </article>
                );
              })}
            </div>
            <Callout title="Status boundary">Pollar and Cosmos Pay have published integration artifacts; Proofwork is merged upstream; OFFER HUB is a partner-hosted Testnet pilot; StelHacks is partner-owned judging code. Trustless Work, ACTA, The Signal, and OpenX402 entries above are hosted or ecosystem pilots with the stated limits. Kutana and Octarine have no technical integration page because no implementation exists.</Callout>
          </section>

          <section className="docs-section" id="timing">
            <SectionHeading eyebrow="Drand" title="Plan deadlines correctly">A valid round must satisfy now &lt; commitDeadline &lt; time(R) &lt; revealDeadline, and the full duration must remain within 30 days.</SectionHeading>
            <div className="docs-timeline"><div><span>Now</span><strong>Create</strong><p>Lot custody and policy persist</p></div><div><span>Commit deadline</span><strong>Seal</strong><p>No new submissions afterward</p></div><div><span>Drand R</span><strong>Open</strong><p>BLS signature unlocks ciphertext</p></div><div><span>Reveal deadline</span><strong>Clear</strong><p>Winner calculation can begin</p></div></div>
            <div className="docs-formula"><code>time(R) = genesis_time + period * (revealRound - 1)</code></div>
            <p className="docs-copy">Use `roundInSeconds(drand, seconds)` to select R. Leave at least 10-15 seconds between commit close and R, plus enough reveal time for one transaction per participant. The current participant cap is 25.</p>
          </section>

          <section className="docs-section" id="lifecycle">
            <SectionHeading eyebrow="Operations" title="Run the permissionless lifecycle">Any funded account can open, reveal, clear, settle, or follow the void path when state and time permit. No operator-only settlement key exists.</SectionHeading>
            <p className="docs-copy">`keeperClient` is any funded SDK client; `drand` is `quicknet()`; `round` comes from `getRoundV2`. Deploy the monitored keeper service for production automation instead of relying on a browser tab.</p>
            <CodeBlock code={lifecycleCode} status="Illustrative" sourceHref="https://github.com/karagozemin/Sub-Rosa/tree/main/services/keeper" />
            <div className="docs-state-table">
              <div><strong>Open</strong><span>Accept sealed commits until commitDeadline</span><code>submitV2</code></div>
              <div><strong>Revealing</strong><span>Drand verified; reveal each bidder independently</span><code>revealV2</code></div>
              <div><strong>Cleared</strong><span>Auction winner is fixed and ready to settle</span><code>settleV2</code></div>
              <div><strong>Settled</strong><span>Terminal success; assets and receipts finalized</span><code>exportReceiptV2</code></div>
              <div><strong>Voided</strong><span>Terminal recovery; escrow and lot returned</span><code>exportReceiptV2</code></div>
            </div>
            <Callout title="Reveal is bounded, not one giant transaction">Opening is one call. Each participant envelope is decrypted and submitted separately so a malformed ciphertext cannot make the whole cohort fail. Treat AlreadyRevealed and RevealAlreadyOpen as successful concurrent progress.</Callout>
          </section>

          <section className="docs-section" id="owner-reveal">
            <SectionHeading eyebrow="Protocol 3" title="Owner-triggered reveal">An optional versioned reveal policy — also called manual reveal — that lets a round's immutable operator choose when reveal opens after Drand R, with a mandatory permissionless fallback so a round can never be stuck. Everything below is opt-in; the defaults are unchanged.</SectionHeading>
            <div className="docs-mode-grid">
              <div><span>Timed (default)</span><h3>Anyone opens after R</h3><p>The classic Core v2 behavior. Once Drand publishes the round signature, any funded account can call <code>openRevealV2</code>. There is no operator window.</p></div>
              <div><span>Owner-triggered (manual)</span><h3>Operator opens, then fallback</h3><p>After R and before <code>fallbackAt</code>, only the immutable operator can open (manual reveal). At or after <code>fallbackAt</code> anyone can open, so a silent operator cannot freeze escrow or the lot.</p></div>
            </div>
            <p className="docs-step-label">Step 1 — detect capability 3 and create the round</p>
            <CodeBlock code={ownerRevealCode} status="Illustrative" sourceHref="https://github.com/karagozemin/Sub-Rosa/blob/main/packages/sdk/scripts/v3-testnet-lifecycle.ts" />
            <p className="docs-step-label">Step 2 — open (manual or fallback), then reveal → clear → settle</p>
            <CodeBlock code={ownerRevealLifecycleCode} status="Illustrative" sourceHref="https://github.com/karagozemin/Sub-Rosa/blob/main/packages/sdk/scripts/v3-testnet-lifecycle.ts" />
            <div className="docs-mode-grid">
              <div>
                <span>Stellar Testnet</span>
                <h3>Protocol 3 deployment</h3>
                <div className="docs-kv-table">
                  <div><span>RPC</span><code>{REVEAL_V3_TESTNET.rpcUrl}</code></div>
                  <div><span>Contract</span><code>{REVEAL_V3_CONTRACT_ID}</code></div>
                  <div><span>WASM SHA-256</span><code>{REVEAL_POLICY_V3_WASM_HASH}</code></div>
                </div>
                <a href={`https://stellar.expert/explorer/testnet/contract/${REVEAL_V3_CONTRACT_ID}`} target="_blank" rel="noreferrer">View protocol 3 contract<ExternalLink size={13} /></a>
              </div>
              <div>
                <span>Constraints</span>
                <h3>Timing rules</h3>
                <ul>
                  <li><code>fallbackAt</code> must be after Drand R</li>
                  <li><code>revealDeadline</code> ≥ <code>fallbackAt</code> + 300s</li>
                  <li><code>void_v2</code> is allowed after <code>revealDeadline</code> + 3600s</li>
                  <li>Applies to both Auction and ReceiptOnly</li>
                  <li>The operator is the immutable controller</li>
                </ul>
              </div>
            </div>
            <div className="docs-kv-table">
              <div><span>Who can open before <code>fallbackAt</code></span><code>operator only (require_auth)</code></div>
              <div><span>Who can open at/after <code>fallbackAt</code></span><code>anyone (permissionless)</code></div>
              <div><span>createRoundV3 with a bad window</span><code>error 46 · InvalidRevealPolicy</code></div>
              <div><span>getRevealStateV3 / open on a Core v2 round</span><code>error 47 · RevealPolicyMissing</code></div>
            </div>
            <Callout title="Unauthorized early opening fails require_auth, not a numbered error" tone="warning">Before <code>fallbackAt</code> the contract calls <code>operator.require_auth()</code>, so a non-operator opening early fails as a host authorization error rather than a numbered contract code. The two numbered protocol-3 codes are <code>46 InvalidRevealPolicy</code> (create with a fallback that is not after Drand R or leaves under 300s before the reveal deadline) and <code>47 RevealPolicyMissing</code> (reading or opening protocol-3 state on a round that has none).</Callout>
            <Callout title="Explicit opt-in; defaults are unchanged" tone="warning">This is a separate deployment. The SDK/UI defaults still resolve to the reviewed Core v2 contract; reach protocol 3 only by passing this contract id (for example via <code>resolveRevealPolicyV3Deployment</code>). Mainnet is pending an independent funds-handling review.</Callout>
            <Callout title="Opening does not extend confidentiality">When Drand publishes the signature, anyone holding a ciphertext can decrypt off-chain, including the operator. The fallback bounds how long the operator can delay on-chain opening; it does not add privacy. Use Timed when operator discretion is undesirable.</Callout>
          </section>

          <section className="docs-section" id="policies">
            <SectionHeading eyebrow="Fairness" title="Fixed escrow and eligibility">Partner policy closes two practical integration gaps while preserving compatibility with earlier Core v2 rounds.</SectionHeading>
            <div className="docs-policy-list">
              <div><ShieldCheck size={20} /><div><h3>Fixed escrow</h3><p>Auction bidders all lock the same public cap. The contract rejects any mismatch with error 45, reducing pre-reveal bid-size leakage.</p></div></div>
              <div><KeyRound size={20} /><div><h3>Optional allowlist</h3><p>An empty list means open access. A non-empty list is enforced by `commit_v2`; non-members receive error 44.</p></div></div>
              <div><Server size={20} /><div><h3>Bounded cohort</h3><p>`maxParticipants` must be 1-25. An allowlist cannot exceed that cap and cannot contain duplicate addresses.</p></div></div>
            </div>
            <CodeBlock status="Illustrative" code={`import { SubRosaClient } from "@sub-rosa/sdk";\n\nconst reader = new SubRosaClient({ network: "testnet" });\nconst policy = await reader.getRoundPolicyV2(roundId);\nif (!policy) throw new Error("Legacy round without partner policy");\n\nconsole.log(policy.fixed_escrow);\nconsole.log(policy.eligible_participants);`} />
          </section>

          <section className="docs-section" id="receipts">
            <SectionHeading eyebrow="Proof" title="Export canonical receipts">A Core v2 receipt is portable JSON containing round configuration, policy, ordered submissions, full revealed envelopes, settlement flags, and available ciphertext evidence.</SectionHeading>
            <CodeBlock code={receiptCode} status="Illustrative" sourceHref="https://github.com/karagozemin/Sub-Rosa/blob/main/docs/RECEIPTS.md" />
            <div className="docs-check-grid"><div><CheckCircle2 size={18} /><span>Network fingerprint</span></div><div><CheckCircle2 size={18} /><span>Full-envelope SHA-256</span></div><div><CheckCircle2 size={18} /><span>Fixed escrow policy</span></div><div><CheckCircle2 size={18} /><span>Allowlist membership</span></div><div><CheckCircle2 size={18} /><span>Deterministic winner</span></div><div><CheckCircle2 size={18} /><span>Settlement flags</span></div></div>
            <Callout title="Offline verification boundary" tone="warning">`verifyReceiptV2` proves internal consistency; it does not contact Stellar. For high-value evidence, export from the pinned network and contract, record the transaction hashes, and independently re-export the round.</Callout>
          </section>

          <section className="docs-section" id="read-api">
            <SectionHeading eyebrow="Data" title="Build read-only experiences">Public reads use simulation and do not need a wallet signature. Configure the SDK without a secret key and provide a public key only if your RPC requires a source account.</SectionHeading>
            <CodeBlock status="Illustrative" code={`import { SubRosaClient } from "@sub-rosa/sdk";\n\nconst reader = new SubRosaClient({ network: "testnet" });\nconst [round, policy, bidders] = await Promise.all([\n  reader.getRoundV2(roundId),\n  reader.getRoundPolicyV2(roundId),\n  reader.getBiddersV2(roundId),\n]);\n\nconst submissions = await Promise.all(\n  bidders.map((bidder) => reader.getSubmissionV2(roundId, bidder)),\n);`} />
            <p className="docs-copy">Durable round and submission state remains available through completion. Ciphertext and auditor blobs live in temporary storage and can expire after the reveal window; receipts report missing temporary evidence honestly as `null`.</p>
          </section>

          <section className="docs-section" id="preflight">
            <SectionHeading eyebrow="Simulation" title="Preflight every wallet action">The SDK can simulate every mutation before signing, returning typed contract errors, fee estimates, and Soroban resource information.</SectionHeading>
            <CodeBlock code={preflightCode} status="Illustrative" />
            <Callout title="Do not parse raw HostError strings">Use `result.error.kind`, `contractErrorCode`, and `contractErrorMessage`. Raw RPC text differs across providers and Stellar SDK versions.</Callout>
          </section>

          <section className="docs-section" id="api-reference">
            <SectionHeading eyebrow="Reference" title="SDK surface: Core v2 and opt-in Protocol 3">The main table includes the Core v2 partner lifecycle plus three explicitly marked Protocol 3 methods. Named `testnet` and `mainnet` clients still default to Core v2; owner-triggered reveal requires the separate Protocol 3 Testnet contract.</SectionHeading>
            <div className="docs-api-table" role="table" aria-label="SDK API methods">
              <div className="head" role="row"><span>Method</span><span>Purpose</span><span>Returns</span></div>
              {API_ROWS.map(([method, purpose, returns]) => <div role="row" key={method}><code>{method}</code><span>{purpose}</span><code>{returns}</code></div>)}
            </div>
            <div className="docs-package-row"><div><Package size={18} /><span>@sub-rosa/sdk</span><code>{SDK_VERSION}</code></div><div><Package size={18} /><span>@sub-rosa/tlock</span><code>{TLOCK_VERSION}</code></div><div><Package size={18} /><span>@sub-rosa/round-bindings</span><code>{BINDINGS_VERSION}</code></div></div>
            <Callout title="Version compatibility and migrations">These three package versions are the currently published, tested release family. Keep the SDK's compatible tlock and binding ranges together, pin them for production builds, and review the <a href="https://github.com/karagozemin/Sub-Rosa/blob/main/packages/sdk/CHANGELOG.md" target="_blank" rel="noreferrer">SDK changelog<ExternalLink size={12} /></a> before upgrading. Core v2 named-network defaults do not migrate a round to the separate Protocol 3 deployment.</Callout>
            <h3>Detailed references</h3>
            <div className="docs-reference-grid">
              {[
                ["SDK configuration and methods", "https://github.com/karagozemin/Sub-Rosa/tree/main/packages/sdk#readme"],
                ["Integration and keeper lifecycle", "https://github.com/karagozemin/Sub-Rosa/blob/main/docs/INTEGRATION.md"],
                ["Architecture and trust boundaries", "https://github.com/karagozemin/Sub-Rosa/blob/main/ARCHITECTURE.md"],
                ["Receipt schema and verification", "https://github.com/karagozemin/Sub-Rosa/blob/main/docs/RECEIPTS.md"],
                ["Threat model", "https://github.com/karagozemin/Sub-Rosa/blob/main/docs/THREAT_MODEL.md"],
                ["Current limitations", "https://github.com/karagozemin/Sub-Rosa/blob/main/docs/LIMITATIONS.md"],
                ["Deployment and secret handling", "https://github.com/karagozemin/Sub-Rosa/blob/main/docs/DEPLOY.md"],
                ["Keeper setup", "https://github.com/karagozemin/Sub-Rosa/tree/main/services/keeper#readme"],
                ["Drand quicknet", "https://docs.drand.love/developer/"],
                ["Freighter connection and signing", "https://github.com/stellar/freighter-developer-docs"],
              ].map(([label, href]) => <a href={href} target="_blank" rel="noreferrer" key={href}><span>{label}</span><ExternalLink size={14} /></a>)}
            </div>
            <p className="docs-copy">The SDK README is authoritative for configuration objects, named network presets, return types, typed SDK errors, preflight helpers, replay/binding validation, and version compatibility. The generated bindings remain available for spec-level calls without duplicating their full surface here.</p>
          </section>

          <section className="docs-section" id="errors">
            <SectionHeading eyebrow="Recovery" title={`All ${ERROR_ROWS.length} contract errors and next actions`}>This table is derived from the authoritative Rust `Error` enum. Handle terminal races idempotently and retry only timing or network failures.</SectionHeading>
            <div className="docs-error-table" role="table" aria-label="Contract errors">
              <div className="head" role="row"><span>Code</span><span>Error</span><span>Meaning</span><span>Action</span></div>
              {ERROR_ROWS.map(([code, name, meaning, action]) => <div role="row" key={code}><code>{code}</code><code>{name}</code><span>{meaning}</span><span>{action}</span></div>)}
            </div>
          </section>

          <section className="docs-section" id="security">
            <SectionHeading eyebrow="Trust" title="Security boundary">Use testnet for pilots and mainnet only with explicit caps, operational controls, and independent review.</SectionHeading>
            <div className="docs-boundary-grid">
              <div><strong>Enforced on-chain</strong><ul><li>Drand BLS signature verification</li><li>Canonical commitment binding</li><li>Fixed escrow and optional allowlist</li><li>Participant and payload bounds</li><li>Atomic Auction settlement and refunds</li></ul></div>
              <div><strong>Operational responsibility</strong><ul><li>Run at least one keeper after R</li><li>Monitor incomplete reveal counts</li><li>Pin network, contract ID, and WASM hash</li><li>Protect server and auditor keys</li><li>Preserve receipts and transaction hashes</li></ul></div>
              <div><strong>Not claimed</strong><ul><li>No independent mainnet funds-handling endorsement</li><li>No private KYC or identity verification</li><li>No atomic reveal-all transaction</li><li>No automatic business decision in ReceiptOnly</li><li>No guaranteed keeper availability</li></ul></div>
            </div>
          </section>

          <section className="docs-section" id="deployment">
            <SectionHeading eyebrow="Ship" title="Production checklist">Complete every item before attaching partner traffic or meaningful value.</SectionHeading>
            <div className="docs-checklist">
              {["Pin the network passphrase, RPC, contract ID, and expected WASM hash", "Run contract, SDK, bindings, tlock, keeper, web, and package tarball tests", "Simulate lot custody and every bidder escrow authorization", "Operate a monitored keeper with retry and duplicate suppression", "Export and independently verify a settled test round receipt", "Define void ownership and incident response for missed reveal windows", "Complete an independent Soroban funds-handling review before mainnet", "Start with explicit value and participant caps"].map((item) => <div key={item}><CheckCircle2 size={18} /><span>{item}</span></div>)}
            </div>
            <CodeBlock label="Terminal" status="Repository command" code={`pnpm contract:test\npnpm tlock:test\npnpm bindings:check\npnpm sdk:test\npnpm keeper:test\npnpm quickstart:check\npnpm packages:pack\npnpm web:test\npnpm web:typecheck\npnpm web:build`} />
            <div className="docs-next"><div><span>Ready to test?</span><h3>Run a real policy-enforced round on testnet.</h3></div><a href="#/pilot">Open pilot workspace<ArrowRight size={17} /></a></div>
          </section>
        </article>
      </div>
    </main>
  );
}
