# Sub Rosa implementation queue

Work is ordered by dependency. Check items only after implementation and validation.

## 1. Keeper and SDK reliability — current scope

- [x] Connect CLI, watch/discovery, stale-round void, dry-run and status reads to Core v2; keep explicit legacy v1 support.
- [x] Continue revealing other participants after a submission-specific contract rejection; keep infrastructure failures visible.
- [x] Add regression coverage for v2 Auction, ReceiptOnly, stale void, discovery and rejected submissions.
- [x] Include all existing SDK tests in the standard test/coverage flow and repair the explicit blob-encoding failure.
- [x] Reject omitted test files in the CI coverage gate.
- [x] Run keeper/SDK tests, type checks and coverage; document the runtime configuration.

Validation: all coverage-workspace tests passed; weighted line coverage 75.67%
(70% required). All workspace type checks, public package builds and documentation
checks passed. No contract deployment or value-moving smoke run was performed.

## 2. Reliability follow-up — local work complete

- [x] Correct Drand round-to-time conversion across contract, SDK, keeper and UI; add boundary tests and plan the contract redeployment.
- [x] Fix health probes treating the expected round-zero `RoundNotFound` response as an outage; verify v2 status endpoints.
- [x] Enforce the keeper settlement guard in the actual watch/settle path; test concurrent passes, duplicate suppression and retry recovery.
- [x] Add web tests, type checks and production build to pull-request CI.
- [x] Split web routes for deferred loading and measure initial bundle size.
- [x] Review remaining incomplete workflows against documented pilot boundaries; record concrete gaps before expanding scope.

## 3. Owner-Triggered Reveal — implemented locally, deployment pending

- [x] Specify immutable controller, Drand privacy boundary, mandatory Auction fallback and a sufficient reveal window.
- [x] Document that Drand publication permits off-chain decryption even before owner-triggered on-chain opening.
- [x] Implement versioned contract policy and compatibility strategy; preserve permissionless reveal/clear/settle after opening.
- [x] Update generated bindings, SDK, keeper, receipts and UI.
- [x] Test authorization, timing boundaries, late/missing owner actions, refunds and legacy behavior.
- [x] Prepare and validate deployment artifacts; track testnet/mainnet deployment separately.

Testnet deployment and live proofs are now recorded in section 4 below.


## Validation — 2026-09-18

- 108 Rust contract tests passed, including real BLS vectors and v3 owner/fallback/refund cases.
- All coverage-workspace tests passed; weighted line coverage **76.17%** (70% required).
- 129 web tests and 6 Drand-tools tests passed; all workspace type checks and public package builds passed.
- Production web build: initial static JavaScript **352.47 kB / 113.90 kB gzip**; other routes load separately. Deferred crypto/SDK chunks remain large.
- Generated bindings match the WASM; error-code parity, snapshot inventory, documentation links/config and threat-model checks passed.
- `pnpm protocol:prepare` produced a **43,640-byte** local WASM with SHA-256 `7a72a82c2678eccaa2f6f3727d4d972640cbabc54f04124c6fc8b68bf150b194`.
- The section-3 validation above was local prepare only. The separate testnet
  deployment and live value-moving proofs are recorded in section 4 below. The
  SDK/UI deployment defaults still resolve to the reviewed Core v2 contract.

Policy details and rollout: [docs/REVEAL_POLICY.md](docs/REVEAL_POLICY.md).
Concrete partner integration boundaries: [docs/PILOT_GAPS.md](docs/PILOT_GAPS.md).

## 4. External rollout

- [ ] Engage an independent funds-handling reviewer (external work, not covered by local tests).
- [x] Deploy the prepared artifact to a new testnet contract and record live owner/fallback/refund proofs and resource costs.
- [ ] Review capped mainnet rollout, deploy separately, and promote deployment defaults only after recording verified evidence.

### Testnet v3 deployment and live proofs — 2026-09-18

- Deployed the reviewed artifact to a **new** testnet contract
  `CB7VIYY4RQLZG2Y6HLDWB3UKSVOAIDYFZ5TGW5AUBCIPJHTCZV4ZWQFF`. On-chain WASM hash
  matches `7a72a82c…b194` and `protocol_version()` advertises capability 3.
  Constructor Quicknet config re-verified against live Drand.
- Live owner-triggered lifecycle across two Auction rounds (evidence in
  `artifacts/reveal-policy-v3/testnet/lifecycle.json`):
  - **Round 1** — operator opened the reveal window under `require_auth`; a
    non-operator bidder was **rejected** before fallback; two bids revealed;
    settlement paid the seller and **fully refunded the losing bidder's escrow**.
  - **Round 2** — the operator never opened; after the fallback timestamp a
    **non-operator (keeper) opened permissionlessly**; the sole bid settled.
  - Classic-asset conservation held exactly: seller `+40`/`−2 lot`, winner
    `−40`/`+2 lot`, loser `0`/`0` (escrow returned). Both receipts exported and
    verified as **version 3**.
  - Actual fees recorded: owner-open `55080`, fallback-open `53570`, settle
    `45916` stroops; per-role XLM spend in the evidence file.
- Deployment defaults were intentionally **not** promoted: per
  [docs/REVEAL_POLICY.md](docs/REVEAL_POLICY.md) the SDK registry, packages and UI
  keep resolving to the reviewed Core v2 contract until independent review; the
  v3 testnet contract is reached via an explicit `CONTRACT_ID`/`VITE_CONTRACT_ID`.
- Not done here: the `void_v2` refund after `reveal_deadline + 3600s` (a one-hour
  on-chain wait) is covered by the contract unit tests, not a live run; mainnet
  deployment and independent funds-handling review remain open.
