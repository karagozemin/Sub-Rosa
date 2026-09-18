# Changelog

All notable changes to `@sub-rosa/sdk` are documented here.

## 0.3.0 — 2026-09-18

### Added

- Owner-Triggered Reveal (protocol 3) deployment registry, exposed as a
  **separate, non-default** opt-in:
  - `SUB_ROSA_REVEAL_POLICY_V3_DEPLOYMENTS` — the protocol 3 deployment table.
    `testnet` is the live, verified contract
    `CB7VIYY4RQLZG2Y6HLDWB3UKSVOAIDYFZ5TGW5AUBCIPJHTCZV4ZWQFF`; `mainnet` is
    `pending` an independent funds-handling review and has no configured contract.
  - `resolveRevealPolicyV3Deployment(network, options)` — resolves a protocol 3
    deployment. Callers must reach it deliberately; networks without a published
    v3 contract require a caller-owned `contractId`.
  - `REVEAL_POLICY_V3_WASM_HASH` — the reviewed protocol 3 WASM hash
    `7a72a82c…b150b194`.
  - `ProtocolVersion` type (`"core-v2" | "reveal-policy-v3"`).

### Unchanged (by rollout policy)

- The SDK/UI **defaults remain Core v2**. `resolveSubRosaDeployment` and
  `new SubRosaClient({ network })` keep resolving to the reviewed Core v2
  contracts. Per `docs/REVEAL_POLICY.md` rollout step 7, defaults are promoted to
  protocol 3 only after independent review; until then the v3 contract is reached
  only by passing its contract id explicitly.
- The protocol 3 client API (`createRoundV3`, `openRevealV2`, `revealV2`,
  `getRevealStateV3`, `supportsRevealPolicy`, version-3 receipts) is unchanged
  from prior releases; this release only makes the deployed contract addressable
  through the registry.
