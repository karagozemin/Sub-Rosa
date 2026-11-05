# SCF #46 — Pollar × Sub Rosa integration evidence

Last updated: 2026-11-05

## Current evidence level

**Live Pollar-signed ReceiptOnly testnet proof verified; package publication pending.**

- Implementation commit: https://github.com/karagozemin/Sub-Rosa/commit/03cb8ec
- Review PR: https://github.com/karagozemin/Sub-Rosa/pull/1
- npm package: not published; `@sub-rosa/pollar-adapter` returned no public
  registry version on 2026-11-05.

This document deliberately distinguishes implementation from validation,
publication, listing, and adoption. A local unit test is not a Pollar-signed
testnet transaction.

| Stage | Status | Evidence |
|---|---|---|
| Proposed integration | Confirmed | Alejandro requested an optional community adapter maintained in the Sub Rosa repo/npm scope. Preserve the original message before public use. |
| Arbitrary Soroban SDK capability | Confirmed in writing | User reports Alejandro confirmed with Oscar that Pollar supports arbitrary Soroban contract transaction signing without restrictions. Preserve the original confirmation before quoting it publicly. |
| Working local adapter | Implemented | `packages/pollar-adapter`, real `@pollar/core@0.12.0` and `@sub-rosa/sdk` types, automated tests and pack validation. |
| Real Pollar testnet lifecycle | Verified | Round 33 completed through the interactive runner with the authenticated READY Pollar G-address below. All five hashes independently resolve to successful Stellar testnet transactions. |
| Public community package | Pending | Package remains `private: true` pending explicit release authorization and final pack validation. |
| Pollar developer listing | Pending | Alejandro's proposed listing must be linked after release. |
| Independent production adoption | Not claimed | A testnet adapter is not customer adoption or economic volume. |

## Developer value

Pollar developers can keep their existing authentication and wallet flow while
optionally adding Sub Rosa's sealed submissions, simultaneous Drand-gated
reveal, and independently verifiable canonical receipts. This targets proposal,
evaluation, allocation, and coordination workflows where premature disclosure
creates bias. It is not intended for ordinary instant payments or swaps.

## Newly developed code

- Typed bridge from Pollar `signTx`/`signAuthEntry` outcomes to the signing
  callbacks consumed by `@sub-rosa/sdk`.
- Testnet/G-address/readiness/network enforcement.
- Transaction body, source, Ed25519 signature, fee-bump, and malformed-XDR
  verification.
- Live-ledger authorization expiry and invocation/address integrity checks.
- Explicit handling for `cosign_pending` and backend policy failures.
- Real-SDK ReceiptOnly lifecycle harness with no fallback signer.
- Local browser authentication runner using Pollar email OTP, Google/GitHub, or
  built-in classic-wallet login. The same in-memory client signs the lifecycle.

Sub Rosa's contract, Drand/tlock implementation, lifecycle, receipt format, and
receipt verifier already existed and were not reimplemented for this adapter.
Pollar core is unchanged.

## Automated verification

Record final command output after the branch is committed:

| Command | Result |
|---|---|
| `pnpm --filter @sub-rosa/pollar-adapter typecheck` | PASS |
| `pnpm --filter @sub-rosa/pollar-adapter test` | PASS — 14/14 |
| `pnpm --filter @sub-rosa/pollar-adapter build` | PASS |
| `pnpm pollar-e2e:build` | PASS — interactive browser runner |
| `npm pack --dry-run` from adapter package | PASS — release manifest validated |
| `pnpm --filter @sub-rosa/sdk test` | PASS — 204/204 |
| `pnpm -r --if-present test` | PASS — all 11 test-bearing workspace projects |

## Live testnet proof

On 2026-11-05 the local browser harness authenticated a real, server-verified
Pollar testnet session with an internally-custodied classic G-address wallet in
`READY` state. The same in-memory `PollarClient` signed all five Sub Rosa writes;
there was no secret-key signer or alternate-wallet fallback. The user explicitly
approved each Pollar signing prompt. Session tokens, DPoP keys, and signing
material were not rendered, logged, exported, or committed.

| Operation | Stellar testnet transaction | Ledger | RPC status |
|---|---|---:|---|
| Create ReceiptOnly round | [`8a30b709e69a77135f88fcb2ca23a29e13d8842f79035ef7957cb603a0627621`](https://stellar.expert/explorer/testnet/tx/8a30b709e69a77135f88fcb2ca23a29e13d8842f79035ef7957cb603a0627621) | 5564495 | SUCCESS |
| Sealed commit | [`4ca02b8eba5c92981e4d45f40a37f306b63898fb6b1f7b11ce9a0072d4ce2a99`](https://stellar.expert/explorer/testnet/tx/4ca02b8eba5c92981e4d45f40a37f306b63898fb6b1f7b11ce9a0072d4ce2a99) | 5564498 | SUCCESS |
| Open reveal | [`193a710bab9c91599ce7f9775126853eec7745097a65438ccff3ce8725e0216e`](https://stellar.expert/explorer/testnet/tx/193a710bab9c91599ce7f9775126853eec7745097a65438ccff3ce8725e0216e) | 5564536 | SUCCESS |
| Reveal | [`05015e4383d4120125260c863c665edd5432f92efed8ca9348dcf29c3d2ca770`](https://stellar.expert/explorer/testnet/tx/05015e4383d4120125260c863c665edd5432f92efed8ca9348dcf29c3d2ca770) | 5564546 | SUCCESS |
| Clear | [`6dd6187af612e1ee5bab8e882ab8bb0d0a905bc94428fc03998e441bc1703a51`](https://stellar.expert/explorer/testnet/tx/6dd6187af612e1ee5bab8e882ab8bb0d0a905bc94428fc03998e441bc1703a51) | 5564579 | SUCCESS |

- Contract ID: `CCOVGOQQZJKZ2R55GRWBLTJTGBAMSHXZVN3ICPG3WRVMLMM6RHISC5OV`
- Round ID: `33`
- Pollar signer G-address: `GCGHLZRGDAOFKUWPCKOG3OIC62ZEHAFM6AKIWJGRLRIX7OIAJT36AGL3`
- Canonical receipt SHA-256 produced by the harness:
  `136dd6ef4e19a5a44cb7b45c8d59d4cdc6c759e55c6f7b0ce45ca60b813536e6`
- `verifyReceiptV2(...).valid`: `true`
- Independently re-exported on-chain state: `ReceiptOnly`, `Settled`, enforced
  allowlist policy, fixed escrow `0`, signer is both operator and sole bidder.
- Independent receipt verification: valid with zero issues.

Independent checks used Stellar testnet RPC and Horizon rather than trusting the
browser display. Every hash has the Pollar G-address as its transaction source,
contains exactly one successful `invoke_host_function` operation, targets the
contract above, and decodes respectively to `create_partner_round_v2`,
`commit_v2`, `open_reveal_v2`, `reveal_v2`, and `clear_v2`.

This direct-source lifecycle proves Pollar `signTx` compatibility for arbitrary
Sub Rosa Soroban transactions. It does not invoke `signAuthEntry`; a separate
non-source authorization flow is still required before claiming live
`signAuthEntry` proof.

## Remaining release gates

1. Exercise a real non-source Soroban authorization entry if that capability is
   included in the first public claim.
2. Obtain explicit release authorization, remove `private: true`, and repeat
   package validation before npm publication.
3. Obtain Pollar's technical acceptance/listing URL. Alejandro's intent is not
   itself evidence that the adapter has been listed.

## SCF wording supported by the live proof

> Sub Rosa maintains an optional Pollar community adapter that lets a classic
> Pollar Stellar wallet execute Sub Rosa ReceiptOnly sealed rounds. The public
> testnet proof includes the create, sealed commit, Drand-gated open, reveal and
> clear transaction hashes plus a canonically verified receipt. The adapter is
> independently maintained in the Sub Rosa repository and does not modify
> Pollar core. This demonstrates developer-tooling interoperability; it is not
> presented as production adoption or transaction volume.
