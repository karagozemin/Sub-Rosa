<p align="center">
  <img src="./assets/sub-rosa-readme.png" width="250" alt="Sub Rosa logo" />
</p>

# Sub Rosa

**Embeddable sealed-market infrastructure for Stellar.** Sub Rosa lets an
application collect private bids or proposals, reveal them at a publicly
verifiable time, and either settle assets atomically or produce a canonical
receipt for an off-chain decision.

<p align="center">
  <a href="https://sub-rosa-web.vercel.app/">Live app</a> |
  <a href="https://sub-rosa-web.vercel.app/#/pilot/the-signal">Testnet pilot / deal flow</a> |
  <a href="https://sub-rosa-web.vercel.app/#/docs">Hosted docs</a> |
  <a href="./docs/INSTAWARDS_COMPLETION.md">Instawards evidence</a> |
  <a href="./packages/sdk/README.md">SDK docs</a> |
  <a href="https://stellar.expert/explorer/testnet/contract/CCOVGOQQZJKZ2R55GRWBLTJTGBAMSHXZVN3ICPG3WRVMLMM6RHISC5OV">Testnet contract</a> |
  <a href="https://stellar.expert/explorer/public/contract/CDQOFNCJE5Z4ZZL76DU5652FOUKJVEIZWHFGCZVWH63UYBGPSZIPC325">Mainnet contract</a>
</p>

Sub Rosa is a protocol and integration stack, not only a hosted application:

- a Soroban sealed-round contract with on-chain Drand BLS12-381 verification;
- a public TypeScript SDK with high-level partner templates;
- a tlock package for deterministic time-locked payloads;
- a permissionless keeper for reveal and settlement;
- a hosted pilot UI with public lifecycle receipts.

The project is licensed under [MIT](./LICENSE).

## Instawards completion evidence

The sealed-auction integration-kit SOW is complete on Stellar testnet. Three
native-XLM Core v2 Auction rounds, each with three bidders, completed the full
commit, Drand reveal, clear, and atomic settle/refund lifecycle:

- [Round 21 receipt](https://sub-rosa-web.vercel.app/#/receipt/instawards-auction-1)
- [Round 22 receipt](https://sub-rosa-web.vercel.app/#/receipt/instawards-auction-2)
- [Round 23 receipt](https://sub-rosa-web.vercel.app/#/receipt/instawards-auction-3)

The [completion evidence pack](./docs/INSTAWARDS_COMPLETION.md) links every
settlement transaction and the reusable template. This is completed Instawards
work and a **pre-SCF baseline**; none of these rounds count toward an SCF
post-award usage target or future SCF-funded deliverable.

## Status at a glance

| Surface | Current status |
| --- | --- |
| Core v2 testnet | Active, with settled `ReceiptOnly` and atomic auction proofs |
| Core v2 mainnet | Official deployment active at the contract linked above |
| Public SDK | `@sub-rosa/sdk`, named `testnet` and `mainnet` presets |
| Hosted pilots | Standalone ReceiptOnly workflows for deal flow, milestone escrow handoff, and optional marketplace proposals |
| Production boundary | Independent funds-handling review still required before uncapped value |

Core v2 uses the same versioned payload envelope, Drand reveal gate,
permissionless lifecycle, public read surface, and deterministic receipt model
on both Stellar networks. An integrator chooses the network and signs for the
matching contract; a testnet deployment is never silently used for mainnet.
The hosted demo may be configured to testnet for safe pilots; its active network
is shown in the UI. Mainnet support is available through the explicit SDK and
deployment configuration documented below.

## Why Sub Rosa

Many applications need a fair private decision before they can safely execute
an on-chain action. A public mempool exposes quotes too early; a trusted
operator can change the outcome; a normal database cannot prove that every
participant saw the same reveal boundary.

Sub Rosa provides the confidential competition primitive while leaving the rest
of the workflow with the integrating application. It is designed to sit inside
existing Stellar products rather than replace their discovery, identity,
selection, payment, or escrow systems.

## Core v2 modes

| Mode | Use it for | What the contract does |
| --- | --- | --- |
| `Auction` | Asset sales, grants, bounties, RFPs, access rights, and other lots that must settle on-chain | Holds the lot, enforces identical bidder escrow, verifies reveals, refunds losers, and atomically transfers the winning payment and lot |
| `ReceiptOnly` | Confidential provider proposals, design-partner pilots, OTC quotes, and loan terms | Seals and reveals the proposal set, records a verifiable receipt, and moves no assets |

Both modes support open rounds or contract-enforced participant allowlists.
`Auction` rounds require one identical public escrow amount for every bidder so
the escrow cannot reveal relative bid sizes before the reveal gate. New partner
workflows should be typed templates over these reviewed modes instead of custom
settlement callbacks.

## How it fits into an application

```text
Partner application
        |
        v
Create a sealed round (Auction or ReceiptOnly)
        |
        v
Participants submit encrypted payloads
        |
        v
Drand round reaches the reveal boundary
        |
        v
Permissionless open -> reveal -> clear
        |
        +--> Auction: contract settles the winning exchange
        |
        +--> ReceiptOnly: application compares the verified receipt and selects
```

The operator cannot decrypt a payload before the configured Drand round. After
the boundary, any account can advance the lifecycle. If reveal cannot complete,
the contract exposes a grace-period void path that returns held assets.

## Hosted deal-flow pilot

[Open the standalone pilot](https://sub-rosa-web.vercel.app/#/pilot/the-signal)

The hosted pilot is a The Signal-style validation surface built entirely on the
Sub Rosa side. It demonstrates the deal flow without requiring a The Signal
database, production-code change, or escrow integration:

1. An organizer creates an OTC or loan deal room.
2. Providers submit private `ReceiptOnly` offers.
3. The organizer chooses a deadline of `2 min`, `5 min`, `1 day`, or `15 days`.
4. Offers remain sealed until the shared reveal boundary.
5. The revealed receipt lets the organizer compare terms and choose a winner
   manually.

This is a named early-pilot and validation workflow, not a claim of production
integration with The Signal. It is intentionally useful as a linkable demo
while leaving settlement and business selection to the partner application.

## Sealed-proposal pilot

Local route: `#/pilot/offer-hub`

This standalone workspace demonstrates the validated marketplace fit: a client
posts a job, optionally enables sealed proposals, several freelancers submit
privately, proposals reveal together, and the client selects a provider
manually. Live mode uses the existing Core v2 `ReceiptOnly` lifecycle; sample
mode is clearly separated local data.

Offer-Hub keeps marketplace discovery, profiles, subscriptions, eligibility,
selection, and payment. Sub Rosa supplies only private proposal submission,
deadline reveal, and receipt evidence. This is a pilot workflow, not a claim
that Offer-Hub has deployed a production integration. See
[the pilot boundary and setup guide](./docs/pilots/OFFER_HUB_PILOT.md).

## Ecosystem validation

- **Build on Stellar Istanbul 2026:** first place in the Hack Privacy track.
- **Stellar ecosystem programs:** SCF and Instawards materials are backed by
  public Core v2 contracts, SDK integration, receipts, and a runnable pilot.
- **The Signal:** early pilot and validation partner for the standalone
  confidential OTC and loan deal-flow pilot above.
- **OpenX402 / Ithaca Labs:** integration work is being explored around sealed
  provider bidding between MCP discovery and x402 payment.

## OpenX402 sealed agent-bidding pilot

Local route: `#/pilot/openx402`

The pilot adds a lightweight `ReceiptOnly` competition between fixture-backed,
clearly labeled OpenX402-style discovery and a typed x402 payment handoff.
Providers bind private offers to discovered resource digests; after reveal, the
application validates the offers against the buyer's spending cap and selects
the lowest valid quote. Sub Rosa records no economic winner and moves no
payment asset.

The OpenX402 selected-quote-to-payment interface is not yet implemented or
invented. The workspace stops at `OpenX402 pricing interface confirmation
required` and shows no fake payment receipt. See
[the pilot boundary and open questions](./docs/pilots/OPENX402_PILOT.md).

These statements describe the current validation scope. They do not imply that
partner production codebases, private databases, or payment rails have been
modified by this repository.

## Public SDK

```bash
npm install @sub-rosa/sdk
```

The SDK includes the tlock and generated contract packages as version-matched
runtime dependencies. Integrators normally need only the SDK:

```ts
import {
  createAssetAuctionRound,
  quicknet,
  sealAssetBid,
  SubRosaClient,
} from "@sub-rosa/sdk";

const client = new SubRosaClient({
  network: "testnet",
  secretKey,
});
const drand = quicknet();

const roundId = await createAssetAuctionRound(client, {
  itemRef,
  paymentAsset: usdcSac,
  lotAsset: collectibleSac,
  lotAmount: 1n,
  fixedEscrow: 1_000n,
  revealRound,
  commitDeadline,
  revealDeadline,
  auditorPubkey,
});

const sealed = await sealAssetBid({
  round: Number(revealRound),
  drand,
  amount: 700n,
});

await client.submitV2({ roundId, sealed, escrow: 1_000n });
```

Use `network: "mainnet"` for the canonical Core v2 public-network deployment.
Browser integrations pass a wallet public key and signing callbacks instead of
placing a secret key in the frontend:

```ts
const client = new SubRosaClient({
  network: "mainnet",
  publicKey: walletAddress,
  signTransaction: wallet.signTransaction,
  signAuthEntry: wallet.signAuthEntry,
});
```

An explicit reviewed `contractId` remains supported for caller-owned
deployments. The SDK checks the RPC passphrase and contract existence before
simulation, signing, or submission, and exposes successful hashes through
`client.submittedTransactionHashes`.

See [packages/sdk/README.md](./packages/sdk/README.md) for proposal templates,
preflight helpers, browser signing, and custom network configuration. See
[docs/INTEGRATION.md](./docs/INTEGRATION.md) for the full lifecycle and keeper
flow.

## Networks, signing, and fees

| Network | SDK setting | Who pays the Stellar fee? |
| --- | --- | --- |
| Stellar Testnet | `network: "testnet"` | The source account that signs the transaction |
| Stellar Mainnet | `network: "mainnet"` | The source account that signs the transaction |

The application must use the contract, RPC, and network passphrase for the
same network. Contract escrow and lot custody are separate from network fees.
Sub Rosa does not subsidize SDK calls by default; an application can add a
relayer if it explicitly wants sponsored fees, in which case that relayer pays.

Repository deployment and capped smoke scripts require an explicit
`MAINNET_CONFIRM=SUB_ROSA_MAINNET` confirmation and funded operator/bidder
accounts. That safety gate applies to those scripts, not as a hidden cap on
wallet-signed SDK integrations.

## Lifecycle and receipts

```text
Create round
    -> submit sealed payload and optional escrow
    -> wait for Drand round R
    -> permissionless open and reveal
    -> deterministic clear
    -> atomic settle or receipt-only completion
    -> public receipt
```

`Auction` settlement transfers the winning payment to the seller, returns the
winner's unused escrow, refunds losing escrow, and transfers the lot to the
winner. `ReceiptOnly` produces a canonical reveal receipt but makes no business
decision and moves no assets. Applications that need ledger provenance should
verify the receipt and query the configured Stellar contract directly.

## Verified artifacts

### Core v2 testnet

| Field | Value |
| --- | --- |
| Contract | [`CCOVGOQQZJKZ2R55GRWBLTJTGBAMSHXZVN3ICPG3WRVMLMM6RHISC5OV`](https://stellar.expert/explorer/testnet/contract/CCOVGOQQZJKZ2R55GRWBLTJTGBAMSHXZVN3ICPG3WRVMLMM6RHISC5OV) |
| WASM hash | `2c7bc6b4c91940ac185df38a3d0a8532b555140d818df94f03f894e5952ebf42` |
| Proposal proof | Round `2` - allowlisted `ReceiptOnly`, settled and receipt verified |
| Atomic auction proof | Round `3` - fixed escrow, `20 SRUSD` to seller and `1 SRLOT` to winner |

### Core v2 mainnet

| Field | Value |
| --- | --- |
| Contract | [`CDQOFNCJE5Z4ZZL76DU5652FOUKJVEIZWHFGCZVWH63UYBGPSZIPC325`](https://stellar.expert/explorer/public/contract/CDQOFNCJE5Z4ZZL76DU5652FOUKJVEIZWHFGCZVWH63UYBGPSZIPC325) |
| Deployment transaction | [`349fe1094c544a88a8ad862a26047f4acd537d77a1aef4d14805ad6827768094`](https://stellar.expert/explorer/public/tx/349fe1094c544a88a8ad862a26047f4acd537d77a1aef4d14805ad6827768094) |
| Network | Stellar public network (Mainnet) |
| WASM hash | `2c7bc6b4c91940ac185df38a3d0a8532b555140d818df94f03f894e5952ebf42` |
| SDK | `network: "mainnet"` selects this Core v2 deployment |

The mainnet deployment is public and capped in the repository's deployment
workflow. It has not received an independent funds-handling audit. Use explicit
value and participant limits, monitored keepers, and a reviewed contract/hash
before any production or uncapped integration.

### Historical mainnet proof

| Field | Value |
| --- | --- |
| Contract | [`CA7KSDEYJEPGZEB2ZROTLUWKQQ6GIRIQNGG6Z745MZ34QHP4UJPWODEX`](https://stellar.expert/explorer/public/contract/CA7KSDEYJEPGZEB2ZROTLUWKQQ6GIRIQNGG6Z745MZ34QHP4UJPWODEX) |
| Round | `1` - settled native XLM smoke |
| Scope | Legacy v1 evidence only; never use it as the Core v2 contract |

## Security boundary and current limits

Sub Rosa reduces early information leakage and makes the reveal boundary
verifiable. It does not provide identity, KYC, legal enforceability, business
underwriting, or a guaranteed keeper service.

- `ReceiptOnly` does not escrow, transfer, or select assets.
- Provider selection in the hosted The Signal pilot remains an organizer
  decision outside the contract.
- A missed reveal window follows the contract's grace-period void path; pilots
  should monitor liveness and define incident ownership.
- The SDK cannot make an unknown deployment trustworthy. Pin the network,
  contract ID, and expected WASM hash.
- Independent Soroban funds-handling review is required before uncapped
  mainnet value.

See [ARCHITECTURE.md](./ARCHITECTURE.md),
[docs/THREAT_MODEL.md](./docs/THREAT_MODEL.md), and
[docs/LIMITATIONS.md](./docs/LIMITATIONS.md).

## Monorepo

```text
contracts/round/          Soroban sealed-round contract
packages/round-bindings/ Generated TypeScript contract bindings
packages/tlock/          Drand tlock and auditor encryption
packages/sdk/            Public integration SDK and templates
services/keeper/         Permissionless lifecycle automation
services/auction-template/ Reference auction integration
apps/web/                 Hosted pilot, docs, and receipt UI
docs/                     Technical, security, and partner documentation
```

## Development

Requirements: Node.js 22+, pnpm 10.13.1, Rust, and Stellar CLI for contract
builds.

```bash
pnpm install
pnpm contract:test
pnpm tlock:test
pnpm bindings:test
pnpm sdk:test
pnpm sdk:typecheck
pnpm packages:build
pnpm packages:pack
pnpm web:test
pnpm web:typecheck
pnpm web:build
pnpm docs:check
pnpm docs:check-links
```

Live network scripts require explicit Stellar keys and configuration. Read
[docs/DEPLOY.md](./docs/DEPLOY.md) before running a value-moving command. Never
commit secret keys, recovery phrases, or local deployment artifacts.

## Documentation

| Document | Purpose |
| --- | --- |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Components, lifecycle, trust boundaries, and storage |
| [docs/INTEGRATION.md](./docs/INTEGRATION.md) | SDK, templates, preflight, keeper, and deployment flow |
| [docs/PLATFORM_PLAN.md](./docs/PLATFORM_PLAN.md) | Partner-ready product scope and remaining gates |
| [docs/PILOT_PLAYBOOK.md](./docs/PILOT_PLAYBOOK.md) | Design-partner and economic-pilot evidence plan |
| [docs/TECH_DESIGN.md](./docs/TECH_DESIGN.md) | Cryptography, Core v2 modes, and settlement rails |
| [docs/THREAT_MODEL.md](./docs/THREAT_MODEL.md) | Adversaries, mitigations, and residual risks |
| [docs/RECEIPTS.md](./docs/RECEIPTS.md) | Receipt schema and offline verification limits |
| [docs/DEPLOY.md](./docs/DEPLOY.md) | Runtime configuration and secret handling |
| [docs/LIMITATIONS.md](./docs/LIMITATIONS.md) | Current network and production boundaries |
| [docs/CI.md](./docs/CI.md) | Continuous-integration checks |
