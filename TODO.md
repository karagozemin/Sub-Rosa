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

## 2. Remaining findings — next

- [ ] Correct Drand round-to-time conversion across contract, SDK, keeper and UI; add boundary tests and plan the contract redeployment.
- [x] Fix health probes treating the expected round-zero `RoundNotFound` response as an outage; verify v2 status endpoints.
- [ ] Enforce the keeper settlement guard in the actual watch/settle path (current queue replay tests use a simulation).
- [ ] Add web tests, type checks and production build to pull-request CI.
- [ ] Split web routes for deferred loading and measure initial bundle size.
- [ ] Review remaining incomplete workflows against documented pilot boundaries; record concrete gaps before expanding scope.
- [ ] Arrange independent funds-handling review before uncapped mainnet use (external work).

## 3. Owner-Triggered Reveal — after reliability work

- [ ] Specify immutable controller, Drand privacy boundary, mandatory Auction fallback and a sufficient reveal window.
- [ ] Document that Drand publication permits off-chain decryption even before owner-triggered on-chain opening.
- [ ] Implement versioned contract policy and compatibility strategy; preserve permissionless reveal/clear/settle after opening.
- [ ] Update generated bindings, SDK, keeper, receipts and UI.
- [ ] Test authorization, timing boundaries, late/missing owner actions, refunds and legacy behavior.
- [ ] Prepare and validate deployment artifacts; track testnet/mainnet deployment separately.
