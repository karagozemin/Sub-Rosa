---
name: sub-rosa
description: Integrate Sub Rosa sealed coordination into Stellar applications with @sub-rosa/sdk. Use when building sealed-bid asset auctions, confidential proposal or procurement rounds, Drand-timed reveal, SAC escrow and atomic lot settlement, permissionless round keepers, Core v2 receipts, or a Sub Rosa testnet or capped-mainnet pilot. Also use when choosing between Auction and ReceiptOnly, wiring Stellar wallets, or reviewing a Sub Rosa lifecycle and security boundary.
---

# Sub Rosa

Build or review an integration against Sub Rosa Core v2. Prefer the public
`@sub-rosa/sdk` templates over custom contract calls. Keep the current network,
deployment, and audit boundary explicit.

## Integration workflow

1. Inspect the application before changing it:
   - Identify its package manager, TypeScript/runtime version, Stellar wallet
     adapter, RPC configuration, asset contracts, and transaction-signing path.
   - Check the installed or current npm version of `@sub-rosa/sdk`; do not invent
     exports from an older version.
   - Read [references/integration.md](references/integration.md) for the concrete
     SDK flow and [references/security-and-lifecycle.md](references/security-and-lifecycle.md)
     before implementing value-moving code.

2. Choose exactly one reviewed mode:

   | Requirement | Mode | Template |
   | --- | --- | --- |
   | Exchange a Stellar payment asset for a Stellar lot asset | `Auction` | `createAssetAuctionRound` |
   | Collect confidential proposals without asset custody | `ReceiptOnly` | `createSealedProposalRound` |

   Use `Auction` only when atomic settlement is economically necessary. Use
   `ReceiptOnly` for procurement, RFP, judging, or design-partner flows where
   the organizer chooses off-chain. Do not add a custom settlement callback for
   a new vertical; express it as typed metadata over one of these modes.

3. Install the single partner-facing package:

   ```bash
   npm install @sub-rosa/sdk
   ```

   Import templates, Drand helpers, tlock helpers, receipt verification, and
   generated contract bindings from `@sub-rosa/sdk`. Install
   `@sub-rosa/tlock` or `@sub-rosa/round-bindings` directly only for low-level
   protocol work.

4. Pin the deployment tuple together:
   - RPC URL
   - network passphrase
   - round contract ID
   - expected WASM hash in deployment policy or configuration

   Never combine a contract ID from one network with another network's RPC or
   passphrase. Let `SubRosaClient` perform its network and contract precheck
   before the first operation.

5. Plan the reveal window before creating the round:

   ```text
   now < commitDeadline < time(drandRound) < revealDeadline
   ```

   Derive the Drand round with `roundInSeconds(quicknet(), delaySeconds)`.
   Leave enough time after Drand publication for retry-safe, per-participant
   reveal transactions. Treat deadlines as Unix timestamps, not ledger numbers.

6. Create and submit through a high-level template:
   - Auction: custody the lot at creation, use one public `fixedEscrow` for all
     bidders, call `sealAssetBid`, then `submitV2` with escrow exactly equal to
     `fixedEscrow`.
   - ReceiptOnly: call `sealProposal`, then `submitV2` with `escrow: 0n`.
   - Add `eligibleParticipants` only when the partner needs a public allowlist.
   - Use integer base units for all Stellar asset amounts.

7. Preflight every wallet mutation before requesting a signature. Use the
   matching `preflight*V2` method, surface typed errors and fee/resource
   estimates, and stop on failure. Do not ask the user to sign a transaction
   that failed simulation.

8. Run the permissionless lifecycle in order:

   ```text
   Open -> openRevealV2 -> Revealing -> revealV2(each participant)
        -> clearV2 -> Cleared -> settleV2(Auction) -> Settled
   ```

   `ReceiptOnly` completes during `clearV2`. Reveal participants independently
   and skip already-revealed entries so retries are safe. Run at least one
   keeper and monitor incomplete reveal counts; permissionless does not mean
   automatic.

9. Export the Core v2 receipt with `exportReceiptV2`, verify it with
   `verifyReceiptV2`, and persist the canonical `serializeReceiptV2` output plus
   transaction hashes. Explain that offline verification checks internal
   consistency, while ledger provenance still requires querying the pinned
   contract and network.

10. Verify the integration at the appropriate depth:
    - Unit-test mode selection, base-unit conversion, payload encoding, and
      preflight failures.
    - Test an end-to-end testnet round with multiple independent participants.
    - Exercise duplicate lifecycle calls and the grace-period `voidV2` recovery
      path.
    - For auctions, reconcile seller payment, winner lot transfer, surplus, and
      losing-bidder refunds.

## Required safety language

Sub Rosa Core v2 has settled testnet proofs and an official capped-mainnet
deployment, but no independent funds-handling audit yet. Do not claim that the
SDK, the hosted UI, or the legacy v1 mainnet smoke proves Core v2 is
production-safe. Use participant and value caps until the deployment is
independently reviewed.

## Sources

- SDK and protocol source: https://github.com/karagozemin/Sub-Rosa/tree/main
- Integration docs: https://www.sub-rosa.online/#/docs
- Published package: https://www.npmjs.com/package/@sub-rosa/sdk
- Stellar smart contract docs: https://developers.stellar.org/docs/build/smart-contracts
- Drand quicknet: https://docs.drand.love/blog/2023/10/16/quicknet-is-live
