import { useMemo, useState } from "react";
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
import { LOGO_SRC } from "../lib/chain";

const TESTNET_DEPLOYMENT = SUB_ROSA_DEPLOYMENTS.testnet;
const MAINNET_DEPLOYMENT = SUB_ROSA_DEPLOYMENTS.mainnet;
const CONTRACT_ID = TESTNET_DEPLOYMENT.contractId;
const WASM_HASH = "2c7bc6b4c91940ac185df38a3d0a8532b555140d818df94f03f894e5952ebf42";
const REVEAL_V3_TESTNET = SUB_ROSA_REVEAL_POLICY_V3_DEPLOYMENTS.testnet;
const REVEAL_V3_CONTRACT_ID = REVEAL_V3_TESTNET.contractId;

type SectionLink = { id: string; label: string; keywords: string };
type NavGroup = { label: string; items: SectionLink[] };

const NAV_GROUPS: NavGroup[] = [
  {
    label: "Start",
    items: [
      { id: "overview", label: "Overview", keywords: "architecture modes stellar soroban" },
      { id: "quickstart", label: "Quickstart", keywords: "install npm client config" },
      { id: "choose-mode", label: "Choose a mode", keywords: "auction receipt proposal" },
      { id: "network", label: "Network & contract", keywords: "testnet rpc wasm deployment" },
    ],
  },
  {
    label: "Build",
    items: [
      { id: "auction", label: "Asset auction", keywords: "seller lot custody fixed escrow bidder" },
      { id: "proposal", label: "Sealed proposal", keywords: "signal procurement receipt only" },
      { id: "browser-wallets", label: "Browser wallets", keywords: "freighter signer frontend bindings" },
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
      { id: "api-reference", label: "SDK reference", keywords: "methods parameters return types" },
      { id: "errors", label: "Errors & recovery", keywords: "contract codes troubleshooting" },
      { id: "security", label: "Security boundary", keywords: "audit production trust threat" },
      { id: "deployment", label: "Deployment checklist", keywords: "production test deploy monitor" },
    ],
  },
];

const ALL_LINKS = NAV_GROUPS.flatMap((group) => group.items);

const installCode = `npm install @sub-rosa/sdk`;

const clientCode = `import { SubRosaClient } from "@sub-rosa/sdk";

const client = new SubRosaClient({
  network: "testnet", // use "mainnet" for the production network
  secretKey: process.env.STELLAR_SECRET,
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
  rpcUrl,
  networkPassphrase,
  contractId,
  secretKey: process.env.BIDDER_SECRET,
});

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

const browserCode = `import { signAuthEntry, signTransaction } from "@stellar/freighter-api";
import { RoundContract } from "@sub-rosa/sdk";

const contract = new RoundContract({
  contractId,
  rpcUrl,
  networkPassphrase,
  publicKey: walletAddress,
  signTransaction: async (xdr, options) => {
    const result = await signTransaction(xdr, {
      networkPassphrase: options?.networkPassphrase ?? networkPassphrase,
      address: options?.address ?? walletAddress,
    });
    if (result.error) throw new Error(String(result.error));
    return {
      signedTxXdr: result.signedTxXdr,
      signerAddress: result.signerAddress,
    };
  },
  signAuthEntry: async (entryXdr, options) => {
    const result = await signAuthEntry(entryXdr, {
      networkPassphrase: options?.networkPassphrase ?? networkPassphrase,
      address: options?.address ?? walletAddress,
    });
    if (result.error || !result.signedAuthEntry) {
      throw new Error(String(result.error ?? "No signed auth entry"));
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
const roundId = await operator.createRoundV3({
  ...auctionParams, // same item / schema / mode / deadline fields as Core v2
  revealPolicy: { type: "owner-triggered", fallbackAt: privacyAt + 300 },
  revealDeadline: privacyAt + 900,
});`;

// Step 2 — manual reveal by the operator, or the permissionless fallback,
// then the identical Core v2 reveal -> clear -> settle flow.
const ownerRevealLifecycleCode = `import { fetchRoundSignature, quicknet } from "@sub-rosa/sdk";

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

// From here the flow is byte-for-byte the Core v2 flow. Reveal each cohort
// envelope separately so one malformed ciphertext cannot fail the group.
for (const bidder of cohort) {
  await bidder.revealV2({ roundId, bidder: bidder.address, envelope });
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
  verifyReceiptV2,
} from "@sub-rosa/sdk";

const receipt = await reader.exportReceiptV2(roundId);
const verification = verifyReceiptV2(receipt);

if (!verification.valid) {
  throw new Error(JSON.stringify(verification.issues));
}

const canonicalJson = serializeReceiptV2(receipt);
console.log(verification.computedWinner);
// Store canonicalJson in your audit log or return it from your API.`;

const preflightCode = `const check = await client.preflightCreatePartnerRoundV2(params);

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
  ["3", "RoundNotFound", "Round ID is absent on this contract", "Check network, contract ID, and round ID together"],
  ["10", "CommitClosed", "Commit deadline passed", "Create a new round; do not retry this commit"],
  ["11", "CommitNotClosed", "Reveal attempted too early", "Retry after commitDeadline"],
  ["12", "CommitDeadlineAfterReveal", "Deadlines do not bracket Drand R", "Use commitDeadline < time(R) < revealDeadline"],
  ["13", "RevealNotOpen", "Reveal gate has not opened", "Call openRevealV2 with the real round-R signature"],
  ["14", "RevealAlreadyOpen", "Another caller opened reveal", "Treat as success and continue revealing"],
  ["15", "RevealWindowClosed", "Envelope arrived after revealDeadline", "Clear or follow the void path"],
  ["16", "RevealStillOpen", "Clear called before revealDeadline", "Retry after ledger time passes the deadline"],
  ["17", "NotCleared", "Settlement called before clear", "Call clearV2 first"],
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
  ["38", "RoundFull", "Participant cap reached", "Create another round"],
  ["39", "InvalidLimit", "Page or participant limit is invalid", "Use supported bounds; Core v2 max is 25"],
  ["40", "UnsupportedVersion", "Protocol or envelope version mismatch", "Use Core v2 and payload envelope v1"],
  ["41", "MalformedPayload", "Envelope is not canonical", "Use SDK seal/open helpers without editing bytes"],
  ["42", "EscrowNotAllowed", "ReceiptOnly received assets or escrow", "Submit exactly zero escrow"],
  ["43", "RoundDurationTooLong", "Round exceeds 30 days", "Shorten deadlines"],
  ["44", "ParticipantNotEligible", "Wallet is not allowlisted", "Use an eligible wallet or recreate the policy"],
  ["45", "EscrowPolicyMismatch", "Auction escrow differs from fixed policy", "Read policy and submit exact fixed_escrow"],
];

function CodeBlock({ code, label = "TypeScript" }: { code: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div className="docs-code">
      <div className="docs-code-head">
        <span>{label}</span>
        <button type="button" onClick={copy} aria-label={`Copy ${label} code`} title="Copy code">
          {copied ? <Check size={15} /> : <Clipboard size={15} />}
          {copied ? "Copied" : "Copy"}
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

export function DocsPage({ goHome }: { goHome: () => void }) {
  const [query, setQuery] = useState("");
  const [mobileNav, setMobileNav] = useState(false);
  const matches = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return [];
    return ALL_LINKS.filter((item) => `${item.label} ${item.keywords}`.toLowerCase().includes(normalized));
  }, [query]);

  function jump(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    setQuery("");
    setMobileNav(false);
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
            placeholder="Search documentation"
            aria-label="Search documentation"
          />
          {query && <button type="button" onClick={() => setQuery("")} aria-label="Clear search"><X size={15} /></button>}
          {query && (
            <div className="docs-search-results">
              {matches.length ? matches.map((item) => (
                <button type="button" key={item.id} onClick={() => jump(item.id)}>
                  <Search size={14} /><span>{item.label}</span><ArrowRight size={14} />
                </button>
              )) : <p>No matching section</p>}
            </div>
          )}
        </div>
        <div className="docs-top-actions">
          <span className="docs-version">SDK v0.3.0</span>
          <a href="https://github.com/karagozemin/Sub-Rosa" target="_blank" rel="noreferrer"><Code2 size={17} />GitHub</a>
          <a href="#/pilot" target="_blank" rel="noreferrer" className="docs-pilot-link">Open pilot<ArrowRight size={16} /></a>
          <button type="button" className="docs-mobile-menu" onClick={() => setMobileNav((value) => !value)} aria-label="Toggle documentation navigation">
            {mobileNav ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </nav>

      <div className="docs-shell">
        <aside className={`docs-sidebar ${mobileNav ? "open" : ""}`}>
          <div className="docs-sidebar-scroll">
            {NAV_GROUPS.map((group) => (
              <div className="docs-nav-group" key={group.label}>
                <strong>{group.label}</strong>
                {group.items.map((item) => <button type="button" key={item.id} onClick={() => jump(item.id)}>{item.label}</button>)}
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
              <div><Package size={18} /><span>Public package</span><strong>@sub-rosa/sdk@0.3.0</strong></div>
              <div><Server size={18} /><span>Live contracts</span><strong>Core v2 mainnet + testnet</strong></div>
              <div><FileCheck2 size={18} /><span>Live proofs</span><strong>Testnet rounds #2 and #3</strong></div>
            </div>
          </section>

          <section className="docs-section" id="quickstart">
            <SectionHeading eyebrow="Start" title="Quickstart">Install one package, connect to the canonical mainnet or testnet contract, and choose a high-level partner template.</SectionHeading>
            <div className="docs-step"><span>1</span><div><h3>Install the SDK</h3><p>The SDK installs compatible tlock and generated binding versions automatically.</p></div></div>
            <CodeBlock code={installCode} label="Terminal" />
            <div className="docs-step"><span>2</span><div><h3>Create a server client</h3><p>Use a funded Stellar signer for writes. Omit `secretKey` and provide `publicKey` for read-only RPC simulation.</p></div></div>
            <CodeBlock code={clientCode} />
            <div className="docs-step"><span>3</span><div><h3>Pick a template</h3><p>Use the Auction helper for atomic value exchange or ReceiptOnly for confidential proposal collection.</p></div></div>
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
            <Callout title="Testnet boundary" tone="warning">This deployment has settled live testnet proofs and has not received an independent funds-handling audit. Do not use it for uncapped mainnet value.</Callout>
            <p className="docs-copy">Use <code>network: "mainnet"</code> for the canonical Core v2 public-network deployment, or pass a reviewed contract override. The signer pays each transaction fee; Sub Rosa does not sponsor SDK writes by default.</p>
          </section>

          <section className="docs-section" id="auction">
            <SectionHeading eyebrow="Guide" title="Asset auction integration">The seller deposits the lot when creating the round. A bidder locks the shared escrow cap, then the contract exchanges winner payment and lot atomically.</SectionHeading>
            <h3>Create the round as seller</h3>
            <p className="docs-copy">`paymentAsset` and `lotAsset` are Stellar Asset Contract addresses, not classic issuer strings. The seller must own `lotAmount` and authorize its transfer during creation.</p>
            <CodeBlock code={auctionCreateCode} />
            <h3>Seal and submit as bidder</h3>
            <p className="docs-copy">The amount and payload remain unreadable until Drand R. The fixed escrow is public, identical for every participant, and must cover the private bid.</p>
            <CodeBlock code={auctionBidCode} />
            <Callout title="SAC prerequisites" tone="warning">The seller needs the lot balance. Every bidder needs the payment asset trustline, balance, and authorization for the exact fixed escrow. Simulate before opening a wallet prompt.</Callout>
          </section>

          <section className="docs-section" id="proposal">
            <SectionHeading eyebrow="Guide" title="Sealed proposal integration">Collect private price, delivery timeline, approach, and partner metadata without moving assets in the first pilot.</SectionHeading>
            <CodeBlock code={proposalCode} />
            <div className="docs-contract-note"><KeyRound size={19} /><div><strong>What becomes public?</strong><p>After Drand R, the price and proposal payload become public by design. Before R, only commitments, ciphertext, participant addresses, and policy metadata are public.</p></div></div>
            <Callout title="Partner selection remains off-chain">ReceiptOnly proves the submitted set, timing, commitment binding, and reveal result. Your marketplace still chooses the provider and owns the downstream engagement.</Callout>
          </section>

          <section className="docs-section" id="browser-wallets">
            <SectionHeading eyebrow="Frontend" title="Browser wallet signing">Use the generated `RoundContract` export when Freighter or another wallet signs in the browser. Keep secret-key clients on trusted server infrastructure.</SectionHeading>
            <CodeBlock code={browserCode} />
            <p className="docs-copy">The generated client exposes spec-accurate snake_case methods such as `create_partner_round_v2` and `commit_v2`. The high-level SDK uses camelCase methods and is ideal for server jobs, keepers, and read-only pages.</p>
          </section>

          <section className="docs-section" id="timing">
            <SectionHeading eyebrow="Drand" title="Plan deadlines correctly">A valid round must satisfy now &lt; commitDeadline &lt; time(R) &lt; revealDeadline, and the full duration must remain within 30 days.</SectionHeading>
            <div className="docs-timeline"><div><span>Now</span><strong>Create</strong><p>Lot custody and policy persist</p></div><div><span>Commit deadline</span><strong>Seal</strong><p>No new submissions afterward</p></div><div><span>Drand R</span><strong>Open</strong><p>BLS signature unlocks ciphertext</p></div><div><span>Reveal deadline</span><strong>Clear</strong><p>Winner calculation can begin</p></div></div>
            <div className="docs-formula"><code>time(R) = drandGenesis + drandPeriod * revealRound</code></div>
            <p className="docs-copy">Use `roundInSeconds(drand, seconds)` to select R. Leave at least 10-15 seconds between commit close and R, plus enough reveal time for one transaction per participant. The current participant cap is 25.</p>
          </section>

          <section className="docs-section" id="lifecycle">
            <SectionHeading eyebrow="Operations" title="Run the permissionless lifecycle">Any funded account can open, reveal, clear, settle, or follow the void path when state and time permit. No operator-only settlement key exists.</SectionHeading>
            <CodeBlock code={lifecycleCode} />
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
            <CodeBlock code={ownerRevealCode} />
            <p className="docs-step-label">Step 2 — open (manual or fallback), then reveal → clear → settle</p>
            <CodeBlock code={ownerRevealLifecycleCode} />
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
            <CodeBlock code={`const policy = await reader.getRoundPolicyV2(roundId);\nif (!policy) throw new Error("Legacy round without partner policy");\n\nconsole.log(policy.fixed_escrow);\nconsole.log(policy.eligible_participants);`} />
          </section>

          <section className="docs-section" id="receipts">
            <SectionHeading eyebrow="Proof" title="Export canonical receipts">A Core v2 receipt is portable JSON containing round configuration, policy, ordered submissions, full revealed envelopes, settlement flags, and available ciphertext evidence.</SectionHeading>
            <CodeBlock code={receiptCode} />
            <div className="docs-check-grid"><div><CheckCircle2 size={18} /><span>Network fingerprint</span></div><div><CheckCircle2 size={18} /><span>Full-envelope SHA-256</span></div><div><CheckCircle2 size={18} /><span>Fixed escrow policy</span></div><div><CheckCircle2 size={18} /><span>Allowlist membership</span></div><div><CheckCircle2 size={18} /><span>Deterministic winner</span></div><div><CheckCircle2 size={18} /><span>Settlement flags</span></div></div>
            <Callout title="Offline verification boundary" tone="warning">`verifyReceiptV2` proves internal consistency; it does not contact Stellar. For high-value evidence, export from the pinned network and contract, record the transaction hashes, and independently re-export the round.</Callout>
          </section>

          <section className="docs-section" id="read-api">
            <SectionHeading eyebrow="Data" title="Build read-only experiences">Public reads use simulation and do not need a wallet signature. Configure the SDK without a secret key and provide a public key only if your RPC requires a source account.</SectionHeading>
            <CodeBlock code={`const reader = new SubRosaClient({ rpcUrl, networkPassphrase, contractId });\n\nconst [round, policy, bidders] = await Promise.all([\n  reader.getRoundV2(roundId),\n  reader.getRoundPolicyV2(roundId),\n  reader.getBiddersV2(roundId),\n]);\n\nconst submissions = await Promise.all(\n  bidders.map((bidder) => reader.getSubmissionV2(roundId, bidder)),\n);`} />
            <p className="docs-copy">Durable round and submission state remains available through completion. Ciphertext and auditor blobs live in temporary storage and can expire after the reveal window; receipts report missing temporary evidence honestly as `null`.</p>
          </section>

          <section className="docs-section" id="preflight">
            <SectionHeading eyebrow="Simulation" title="Preflight every wallet action">The SDK can simulate every mutation before signing, returning typed contract errors, fee estimates, and Soroban resource information.</SectionHeading>
            <CodeBlock code={preflightCode} />
            <Callout title="Do not parse raw HostError strings">Use `result.error.kind`, `contractErrorCode`, and `contractErrorMessage`. Raw RPC text differs across providers and Stellar SDK versions.</Callout>
          </section>

          <section className="docs-section" id="api-reference">
            <SectionHeading eyebrow="Reference" title="Core v2 SDK surface">These are the primary high-level methods. Generated bindings and contract types are re-exported from the same package.</SectionHeading>
            <div className="docs-api-table" role="table" aria-label="SDK API methods">
              <div className="head" role="row"><span>Method</span><span>Purpose</span><span>Returns</span></div>
              {API_ROWS.map(([method, purpose, returns]) => <div role="row" key={method}><code>{method}</code><span>{purpose}</span><code>{returns}</code></div>)}
            </div>
            <div className="docs-package-row"><div><Package size={18} /><span>@sub-rosa/sdk</span><code>0.3.0</code></div><div><Package size={18} /><span>@sub-rosa/tlock</span><code>0.2.0</code></div><div><Package size={18} /><span>@sub-rosa/round-bindings</span><code>0.2.0</code></div></div>
          </section>

          <section className="docs-section" id="errors">
            <SectionHeading eyebrow="Recovery" title="Contract errors and next actions">Contract error codes are stable public API. Handle terminal races idempotently and retry only timing or network failures.</SectionHeading>
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
            <CodeBlock label="Terminal" code={`pnpm contract:test\npnpm tlock:test\npnpm bindings:check\npnpm sdk:test\npnpm keeper:test\npnpm packages:pack\npnpm web:test\npnpm web:build`} />
            <div className="docs-next"><div><span>Ready to test?</span><h3>Run a real policy-enforced round on testnet.</h3></div><a href="#/pilot">Open pilot workspace<ArrowRight size={17} /></a></div>
          </section>
        </article>
      </div>
    </main>
  );
}
