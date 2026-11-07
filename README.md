<p align="center">
  <img src="./assets/sub-rosa-readme.png" width="180" alt="Sub Rosa logo" />
</p>

# Sub Rosa — Sealed Coordination Infrastructure for Stellar

**Embeddable sealed auctions, private proposals, and verifiable decision
workflows powered by Soroban and Drand.** Sub Rosa lets a Stellar application
collect competing submissions without exposing their contents before a shared
reveal boundary, then either settle an asset auction atomically or export a
canonical receipt for an application-controlled decision.

<p align="center">
  <a href="https://www.sub-rosa.online/">Live application</a> ·
  <a href="https://www.sub-rosa.online/#/docs">Developer documentation</a> ·
  <a href="https://www.sub-rosa.online/#/pilot">Pilot Workspaces</a> ·
  <a href="https://www.npmjs.com/package/@sub-rosa/sdk">SDK on npm</a> ·
  <a href="./docs/WEBSITE_ECOSYSTEM_AUDIT_2026-11-07.md">Integration evidence</a>
</p>

Sub Rosa is already shipped as a Soroban protocol, four public npm packages,
permissionless keeper, hosted pilots, active Core v2 Testnet and Mainnet
deployments, and independently visible ecosystem integrations. It is not a
claim that every pilot is production-live or that the contracts have completed
an independent funds-handling audit.

| Mode | Best for | Protocol boundary |
| --- | --- | --- |
| **Auction** | Asset sales, grants, bounties, access rights, and other on-chain lots | Holds the lot and identical bidder escrow, verifies reveals, computes the winner, refunds losers, and atomically exchanges payment and lot |
| **ReceiptOnly** | Private proposals, RFQs, reviews, judging, and deal terms | Seals and reveals the complete submission set and exports a verifiable receipt; it takes no partner funds and makes no business selection |

## Built Across the Stellar Ecosystem

The table separates partner-owned or independently published evidence from
Sub Rosa-hosted demonstrations. Statuses were rechecked on **November 8, 2026**.

| Project | Implemented workflow | Current status | Independent evidence | Demo / additional proof |
| --- | --- | --- | --- | --- |
| **Pollar** | Optional community adapter for classic-wallet `signTx` and standalone Soroban `signAuthEntry` callbacks in Testnet `ReceiptOnly` flows | Published SDK integration; maintained by Sub Rosa, not part of Pollar core | [Official Pollar listing](https://docs.pollar.xyz/docs/guides/community-integrations#sub-rosa-adapter) · [npm adapter](https://www.npmjs.com/package/@sub-rosa/pollar-adapter/v/0.1.0) | [Successful auth-entry transaction](https://stellar.expert/explorer/testnet/tx/a1c56b0c2d206c7aafd0d4b16e46596f4ac6e4f05ea90c565787c565c6810fda) · [evidence report](./docs/SCF46_POLLAR_INTEGRATION_EVIDENCE.md) |
| **Cosmos Pay** | Signed community plugin binds private RFQs to client-verified `ReceiptOnly` results and an existing tenant payment intent | Official community plugin; sandbox-tested, with no claim of live merchant payment volume | [Plugin in official `main`](https://github.com/CosmosPay/CosmosPay-Community-Server/tree/main/plugins/sub-rosa) | [Integration source and E2E runner](https://github.com/karagozemin/cosmospay-sub-rosa-plugin) |
| **Proofwork** | Fixed founder/admin plus campaign-creator reviewers submit independent sealed assessments, reveal together, verify the receipt, and leave the final decision to the administrator | Merged into upstream `main`; Testnet evidence, not a production deployment | [Merged upstream PR #1](https://github.com/CemAyyildiz/Proofwork/pull/1) | [Round 44 evidence](https://github.com/CemAyyildiz/Proofwork/blob/main/docs/evidence/sub-rosa-sealed-dual-review-testnet.json) records a valid zero-escrow receipt; upstream reports 993 passing tests, which this repository did not rerun |
| **OFFER HUB** | Optional sealed freelancer proposals with shared reveal and client-controlled provider selection | Merged into upstream `dev`; partner-hosted Testnet pilot, not verified on production `main` | [Merged PR #479](https://github.com/OFFER-HUB/OFFER-HUB-Frontend/pull/479) | [Partner deployment](https://offer-hub-subrosa-plum.vercel.app/) · [separate Sub Rosa workspace](https://www.sub-rosa.online/#/pilot/offer-hub) |
| **StelHacks** | Blind judging payloads are sealed to the first Drand round at or after the frozen judging deadline | Partner-owned judging integration | [Commit-pinned implementation](https://github.com/emirykl/StelHacks/blob/930efa97a2a1cf15eabbd375f6ee0ea437766e27/frontend/lib/sealed-input.ts#L1-L49) | Demonstrates deadline-bound tlock sealing, not Core v2 settlement or event volume |
| **Trustless Work** | Testnet proposal selection followed by a multi-release escrow handoff | Ecosystem pilot; Trustless Work owns escrow creation, funding, milestones, release, and payment | [Official ecosystem directory](https://www.trustlesswork.com/ecosystem) | [Testnet workspace](https://www.sub-rosa.online/#/pilot/trustless-work) |

Additional working Pilot Workspaces demonstrate narrower boundaries:

| Workspace | What it demonstrates | What it does not claim |
| --- | --- | --- |
| [ACTA](https://www.sub-rosa.online/#/pilot/acta) | Credential status, type, issuer, and holder checks before an application-level sealed submission gate | ACTA eligibility is not enforced by the Sub Rosa contract; this is not a production partner deployment |
| [The Signal](https://www.sub-rosa.online/#/pilot/the-signal) | Sealed OTC and loan offers with organizer selection | No access to or modification of The Signal production systems |
| [OpenX402](https://www.sub-rosa.online/#/pilot/openx402) | Resource-bound agent quotes and a typed post-selection handoff | Fixture discovery only; no x402 payment is executed and Sub Rosa records no economic winner |

Kutana and Octarine are exploratory discussions in the ecosystem registry, not
implemented integrations, and are intentionally excluded from the verified
table.

## Why Sub Rosa Matters for Stellar

Competitive workflows fail when later participants can inspect earlier bids,
quotes, reviews, or preferences before submitting their own. Without an
embeddable primitive, every Stellar application must independently build
encryption, commitment binding, wallet authorization, reveal timing, receipt
verification, retries, and recovery behavior.

Sub Rosa packages those responsibilities into reusable infrastructure while
the integrating product retains its identity, eligibility, business rules,
selection, payouts, and escrow systems:

- OFFER HUB can keep freelancer price, timeline, and approach private until a
  shared deadline.
- Proofwork can collect two independent human assessments before either is
  visible.
- Cosmos Pay can coordinate private RFQs without moving merchant payments into
  Sub Rosa.
- StelHacks can prevent early access to judging payloads.
- Auction mode can custody a Stellar lot and fixed escrow, then settle the
  winning exchange and refunds atomically.

The economic value is integration reuse and verifiable coordination—not an
invented claim about transaction volume, savings, or production adoption.

## Architecture and Protocol Lifecycle

```text
Partner UX / backend + wallet signer
                 |
                 v
          @sub-rosa/sdk
           /           \
@sub-rosa/tlock     generated round bindings
           \           /
            Soroban Round contract <--- Drand signature
                    ^
                    |
        permissionless keeper
                    |
                    v
       canonical receipt export + verification
```

| Component | Responsibility |
| --- | --- |
| Soroban Round contract | Deadlines, participant policy, Drand BLS verification, commitments, lifecycle state, optional asset custody, deterministic Auction settlement, and recovery |
| `@sub-rosa/sdk` | Named network presets, high-level Auction and proposal templates, reads, preflight, signing callbacks, writes, and receipt export |
| `@sub-rosa/tlock` | Drand round selection, canonical payload sealing/opening, commitments, and optional auditor encryption |
| `@sub-rosa/round-bindings` | Generated, spec-accurate TypeScript bindings for the Round contract |
| Keeper | Permissionless, retry-safe open/reveal/clear/settle/void automation; it has no privileged protocol authority |
| Canonical receipts | Portable evidence for commitments, revealed envelopes, policy, result, and settlement flags; offline verification does not itself prove ledger provenance |

```text
Create -> Commit -> Open -> Reveal -> Clear
                                     |-- Auction: Settle or Void
                                     `-- ReceiptOnly: Export verified receipt
```

Core v2 is the default on Testnet and Mainnet. Optional **Protocol 3** is a
separate Testnet deployment that lets an immutable operator open after Drand
and before a mandatory permissionless fallback. It does not delay off-chain
decryptability after Drand publishes the signature, and it is never selected by
the default SDK network presets. See [architecture](./ARCHITECTURE.md) and the
[reveal-policy specification](./docs/REVEAL_POLICY.md).

## Developer Quickstart

Install the current published SDK:

```bash
npm install @sub-rosa/sdk
```

For a complete first integration, use the
[Stellar Testnet ReceiptOnly quickstart](./examples/receipt-only-quickstart/).
It creates a real round, seals a structured proposal, submits, opens, reveals,
clears, exports, and verifies the canonical receipt.

```bash
corepack enable
pnpm install
cp examples/receipt-only-quickstart/.env.example examples/receipt-only-quickstart/.env
pnpm quickstart:keypair
pnpm quickstart:check   # offline typecheck + unit tests; no Drand wait
pnpm quickstart:live    # optional funded Stellar Testnet lifecycle
```

The live command requires a disposable funded Testnet account and a server-side
`STELLAR_SECRET_KEY`. Never put secret keys in frontend code or reuse a Mainnet
key. Offline validation passing is not presented as proof that a new live run
was performed.

Continue with the [hosted Quickstart](https://www.sub-rosa.online/#/docs/quickstart),
[SDK reference](./packages/sdk/README.md), and
[integration guide](./docs/INTEGRATION.md). Browser applications provide a
public key and wallet signing callbacks rather than a secret.

## Adoption & Developer Distribution

Public package versions and npm download counts were rechecked on **November 8,
2026**:

| Package | Current version | npm-reported downloads through 2026-11-08 |
| --- | ---: | ---: |
| [`@sub-rosa/sdk`](https://www.npmjs.com/package/@sub-rosa/sdk) | `0.3.2` | [1,303](https://api.npmjs.org/downloads/point/2025-05-08:2026-11-08/%40sub-rosa%2Fsdk) |
| [`@sub-rosa/tlock`](https://www.npmjs.com/package/@sub-rosa/tlock) | `0.3.0` | [769](https://api.npmjs.org/downloads/point/2025-05-08:2026-11-08/%40sub-rosa%2Ftlock) |
| [`@sub-rosa/round-bindings`](https://www.npmjs.com/package/@sub-rosa/round-bindings) | `0.3.0` | [612](https://api.npmjs.org/downloads/point/2025-05-08:2026-11-08/%40sub-rosa%2Fround-bindings) |
| [`@sub-rosa/pollar-adapter`](https://www.npmjs.com/package/@sub-rosa/pollar-adapter) | `0.1.0` | [187](https://api.npmjs.org/downloads/point/2025-05-08:2026-11-08/%40sub-rosa%2Fpollar-adapter) |
| **Combined** | — | **2,871** |

npm downloads include automated installs and transitive dependencies; they are
not unique developers, users, rounds, or economic volume. Likewise, a merged
integration is not automatically a production deployment, and Testnet rounds
are not financial volume.

- [Stellar Developer Skills](https://skills.stellar.org/) lists Sub Rosa as a
  community skill. The directory explicitly says community skills are not SDF
  endorsements, audits, or warranties.
- Rise In's independent [builder spotlight](https://www.risein.com/blog/builder-spotlight-from-hackathon-curiosity-to-building-sub-rosa-on-stellar)
  records Sub Rosa's first-place privacy-track win in Istanbul and identifies
  Emin as its builder.

## Deployments & Verifiable Evidence

The SDK deployment registry is authoritative for current defaults:

| Network | Protocol | Contract | Status | Explorer |
| --- | --- | --- | --- | --- |
| Stellar Testnet | Core v2 | `CCOVGOQQZJKZ2R55GRWBLTJTGBAMSHXZVN3ICPG3WRVMLMM6RHISC5OV` | Active SDK default | [Contract](https://stellar.expert/explorer/testnet/contract/CCOVGOQQZJKZ2R55GRWBLTJTGBAMSHXZVN3ICPG3WRVMLMM6RHISC5OV) |
| Stellar Mainnet | Core v2 | `CDQOFNCJE5Z4ZZL76DU5652FOUKJVEIZWHFGCZVWH63UYBGPSZIPC325` | Active SDK default; capped use only pending independent review | [Contract](https://stellar.expert/explorer/public/contract/CDQOFNCJE5Z4ZZL76DU5652FOUKJVEIZWHFGCZVWH63UYBGPSZIPC325) |
| Stellar Testnet | Protocol 3 owner-triggered reveal | `CB7VIYY4RQLZG2Y6HLDWB3UKSVOAIDYFZ5TGW5AUBCIPJHTCZV4ZWQFF` | Active, explicit opt-in | [Contract](https://stellar.expert/explorer/testnet/contract/CB7VIYY4RQLZG2Y6HLDWB3UKSVOAIDYFZ5TGW5AUBCIPJHTCZV4ZWQFF) |

- Core v2 WASM SHA-256: `2c7bc6b4c91940ac185df38a3d0a8532b555140d818df94f03f894e5952ebf42`
- Protocol 3 WASM SHA-256: `7a72a82c2678eccaa2f6f3727d4d972640cbabc54f04124c6fc8b68bf150b194`
- Protocol 3 Mainnet remains pending and has no configured default contract.

Representative evidence:

- **Pollar signing:** [Round 35 authorization-entry transaction](https://stellar.expert/explorer/testnet/tx/a1c56b0c2d206c7aafd0d4b16e46596f4ac6e4f05ea90c565787c565c6810fda).
- **Proofwork:** [merged integration](https://github.com/CemAyyildiz/Proofwork/pull/1)
  and [verified Testnet round 44 evidence](https://github.com/CemAyyildiz/Proofwork/blob/main/docs/evidence/sub-rosa-sealed-dual-review-testnet.json).
- **Cosmos Pay:** [official signed plugin](https://github.com/CosmosPay/CosmosPay-Community-Server/tree/main/plugins/sub-rosa)
  and [sandbox/E2E source](https://github.com/karagozemin/cosmospay-sub-rosa-plugin).
- **Instawards baseline:** Testnet Auction rounds
  [21](https://www.sub-rosa.online/#/receipt/instawards-auction-1),
  [22](https://www.sub-rosa.online/#/receipt/instawards-auction-2), and
  [23](https://www.sub-rosa.online/#/receipt/instawards-auction-3) completed
  three-bidder commit, reveal, clear, atomic settlement, and refund lifecycles.
  The [completion pack](./docs/INSTAWARDS_COMPLETION.md) and
  [completed SOW](./docs/INSTAWARDS_SOW_COMPLETED.pdf) are pre-SCF baseline
  evidence, not future SCF deliverables.
- **Mainnet Core v2:** deployment transaction
  [`349fe109…68094`](https://stellar.expert/explorer/public/tx/349fe1094c544a88a8ad862a26047f4acd537d77a1aef4d14805ad6827768094)
  and capped round 1 receipt
  [`instawards-mainnet-auction-1.json`](./apps/web/public/instawards/receipts/instawards-mainnet-auction-1.json).
- **Receipt interpretation:** [schema, export, and offline verification limits](./docs/RECEIPTS.md).

The legacy v1 Mainnet contract
[`CA7KS…WODEX`](https://stellar.expert/explorer/public/contract/CA7KSDEYJEPGZEB2ZROTLUWKQQ6GIRIQNGG6Z745MZ34QHP4UJPWODEX)
is preserved as historical evidence only and is never selected as a Core v2
default.

## Security & Trust Boundaries

| Boundary | Current guarantee or limitation |
| --- | --- |
| Before reveal | Bid/proposal amount and application payload remain encrypted under the Drand/tlock assumption. Round metadata, deadlines, participant addresses, commitments, ciphertext, and fixed escrow are public. |
| After reveal | Successfully revealed canonical envelopes become public contract/receipt evidence. Sub Rosa is delayed disclosure, not permanent payload secrecy. |
| Contract verification | Enforces lifecycle timing, Drand signature validity, commitment binding, payload/version limits, participant policy, fixed escrow, Auction clearing, settlement, refunds, and void rules. |
| Application responsibility | Identity, KYC, legal terms, eligibility outside the public allowlist, ReceiptOnly selection, payment, fulfillment, and downstream escrow remain with the integrator. |
| Custody | `Auction` holds the lot and bidder escrow for the round. `ReceiptOnly` rejects escrow and moves no partner assets. |
| Authorization and replay | Stellar signatures authorize writes; the contract stores each commitment under a specific round and bidder, then checks the revealed value and nonce. Receipts are version-, status-, and network-fingerprint-bound but can still become stale. Integrators must pin network, contract ID, and WASM hash. |
| Keeper liveness | Lifecycle calls are permissionless, but availability is not guaranteed. Production operators must run monitoring, retries, duplicate suppression, and incident response. |
| Recovery | A grace-period void path returns held assets when state and time allow. Reveal is processed per participant rather than in one atomic reveal-all transaction. |
| Receipts | `verifyReceiptV2` checks internal consistency offline; it does not query Stellar or independently prove that exported metadata matches current ledger state. |
| Mainnet readiness | Core v2 has a capped public proof but no independent funds-handling audit. Do not treat it as approval for uncapped production escrow. |

Read the [threat model](./docs/THREAT_MODEL.md),
[known limitations](./docs/LIMITATIONS.md),
[deployment and secret-handling guide](./docs/DEPLOY.md), and
[architecture](./ARCHITECTURE.md) before integrating meaningful value.

## Available Today vs. Next Priorities

### Available Today

- Implemented Core v2 `Auction` and `ReceiptOnly` protocol.
- Published SDK, tlock, generated bindings, and Pollar adapter.
- Active Core v2 Testnet/Mainnet deployments and opt-in Protocol 3 Testnet.
- Permissionless keeper, preflight helpers, typed errors, canonical receipts,
  and offline verification.
- Six working Pilot Workspaces plus published, official-plugin, merged-upstream,
  partner-hosted, and partner-owned integration evidence at the scopes above.
- Reproducible CI, package tarball checks, runnable quickstart, and public
  deployment artifacts.

### Next Development Priorities

- Independent review and remediation of funds-handling paths.
- Production operational hardening for keeper availability, monitoring,
  retries, and incident response.
- Additional independently adopted integration paths with reproducible public
  acceptance evidence.
- An economically meaningful, value-capped Auction pilot with external
  participants, settlement/refund evidence, and a recorded partner decision.
- Stronger ledger-backed receipt provenance and reproducible release evidence.

These are incremental priorities from the current
[partner-ready platform plan](./docs/PLATFORM_PLAN.md) and
[pilot playbook](./docs/PILOT_PLAYBOOK.md); already completed packages,
deployments, integrations, and pilots are not presented as future work.

## Maintainer

Sub Rosa is currently built and maintained by
[Emin Karagöz (`@karagozemin`)](https://github.com/karagozemin). As the primary
and solo project maintainer, he is responsible for the Soroban protocol,
TypeScript SDK and tlock engineering, architecture, Testnet/Mainnet deployment,
partner integration work, evidence, documentation, and ongoing maintenance.
Partner-owned repositories and external contributors remain credited by their
own commits and links; the project does not imply a larger internal engineering
team.

## Repository Layout

```text
contracts/round/                    Soroban sealed-round contract
packages/sdk/                       Public integration SDK and templates
packages/tlock/                     Drand tlock and auditor encryption
packages/round-bindings/            Generated TypeScript contract bindings
packages/pollar-adapter/            Optional Pollar signing adapter
services/keeper/                    Permissionless lifecycle automation
services/auction-template/          Reference Auction integration
examples/receipt-only-quickstart/   Runnable first ReceiptOnly integration
apps/web/                           Hosted app, docs, pilots, and receipts
docs/                               Architecture, security, evidence, and operations
```

## Development and Tests

Requirements: Node.js 22+, pnpm 10.13.1, Rust, and Stellar CLI for contract or
binding builds.

```bash
pnpm install
pnpm contract:test
pnpm errors:check
pnpm tlock:test
pnpm bindings:test
pnpm sdk:test
pnpm quickstart:check
pnpm packages:pack
pnpm web:test
pnpm web:typecheck
pnpm web:build
pnpm docs:check
pnpm docs:check-links
```

GitHub Actions independently checks the contract and error enum, generated
bindings, aggregate TypeScript coverage, public package tarballs, documentation
links, and web typecheck/tests/build. See [CI and quality gates](./docs/CI.md).
Live network scripts require explicit keys and configuration; read
[deployment guidance](./docs/DEPLOY.md) before any value-moving command.

## Documentation

| Document | Purpose |
| --- | --- |
| [Hosted developer docs](https://www.sub-rosa.online/#/docs) | Searchable Quickstart, modes, wallets, integrations, lifecycle, API, errors, and security |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Components, protocol lifecycle, storage, and partner boundaries |
| [docs/INTEGRATION.md](./docs/INTEGRATION.md) | SDK templates, signing, preflight, reads, keeper, and errors |
| [docs/TECH_DESIGN.md](./docs/TECH_DESIGN.md) | Cryptography, Core v2 modes, and settlement rails |
| [docs/RECEIPTS.md](./docs/RECEIPTS.md) | Receipt schema, serialization, verification, and provenance limits |
| [docs/THREAT_MODEL.md](./docs/THREAT_MODEL.md) | Adversaries, protections, assumptions, and residual risk |
| [docs/LIMITATIONS.md](./docs/LIMITATIONS.md) | Current network, operational, and production boundaries |
| [docs/DEPLOY.md](./docs/DEPLOY.md) | Runtime configuration, network safety, and secret handling |
| [docs/PILOT_PLAYBOOK.md](./docs/PILOT_PLAYBOOK.md) | Design-partner and economic-pilot evidence requirements |
| [docs/CI.md](./docs/CI.md) | Automated tests and coverage gates |

## Contributing and License

Bug reports, integration questions, and narrowly scoped pull requests are
welcome through [GitHub Issues](https://github.com/karagozemin/Sub-Rosa/issues).
Before opening a PR, run the relevant commands above, avoid committing secrets
or generated local deployment artifacts, and document any change to protocol,
security, or evidence boundaries.

Sub Rosa is licensed under the [MIT License](./LICENSE).
