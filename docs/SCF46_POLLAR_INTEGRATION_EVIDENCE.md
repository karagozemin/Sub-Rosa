# SCF #46 — Pollar × Sub Rosa integration evidence

Last updated: 2026-11-05

## Current evidence level

**Working local adapter; live Pollar-signed testnet proof pending credentials.**

This document deliberately distinguishes implementation from validation,
publication, listing, and adoption. A local unit test is not a Pollar-signed
testnet transaction.

| Stage | Status | Evidence |
|---|---|---|
| Proposed integration | Confirmed | Alejandro requested an optional community adapter maintained in the Sub Rosa repo/npm scope. Preserve the original message before public use. |
| Arbitrary Soroban SDK capability | Confirmed in writing | User reports Alejandro confirmed with Oscar that Pollar supports arbitrary Soroban contract transaction signing without restrictions. Preserve the original confirmation before quoting it publicly. |
| Working local adapter | Implemented | `packages/pollar-adapter`, real `@pollar/core@0.12.0` and `@sub-rosa/sdk` types, automated tests and pack validation. |
| Real Pollar testnet lifecycle | Pending | Requires an authenticated READY Pollar G-address session; no secret-key or alternate-wallet fallback is accepted. |
| Public community package | Pending | Package remains `private: true` until the live proof succeeds. |
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
| `npm pack --dry-run` from adapter package | PASS — release manifest validated |
| `pnpm --filter @sub-rosa/sdk test` | PASS — 204/204 |
| `pnpm -r --if-present test` | PASS — all 11 test-bearing workspace projects |

## Live testnet proof

The harness requires a real Pollar session and prints a JSON evidence object.
Do not populate this table from mock tests or a secret-key-signed Sub Rosa run.
The attempted live run stopped before network submission because no
`POLLAR_SESSION_MODULE` or authenticated Pollar session is present in this
workspace. This is the only current E2E execution blocker.

| Operation | Stellar testnet transaction hash | RPC status |
|---|---|---|
| Create ReceiptOnly round | Pending real Pollar session | Pending |
| Sealed commit | Pending real Pollar session | Pending |
| Open reveal | Pending real Pollar session | Pending |
| Reveal | Pending real Pollar session | Pending |
| Clear | Pending real Pollar session | Pending |

- Contract ID: pending live run
- Round ID: pending live run
- Pollar signer G-address: pending live run
- Canonical receipt SHA-256: pending live run
- `verifyReceiptV2(...).valid`: pending live run
- Live `signAuthEntry` proof: pending a flow that actually requests a non-source
  Soroban authorization entry; the direct-source lifecycle primarily proves
  arbitrary Soroban transaction signing.

## Remaining release gates

1. Provide an authenticated Pollar testnet application/session without storing
   credentials in the repository.
2. Fund the Pollar G-address with testnet XLM if it is not sponsored.
3. Run the full harness and independently check every hash on Stellar testnet.
4. Exercise a real non-source Soroban authorization entry if that capability is
   included in the first public claim.
5. Add the resulting public evidence, remove `private: true`, and repeat package
   validation before npm publication.
6. Obtain Pollar's technical acceptance/listing URL. Alejandro's intent is not
   itself evidence that the adapter has been listed.

## SCF wording after the live proof only

> Sub Rosa maintains an optional Pollar community adapter that lets a classic
> Pollar Stellar wallet execute Sub Rosa ReceiptOnly sealed rounds. The public
> testnet proof includes the create, sealed commit, Drand-gated open, reveal and
> clear transaction hashes plus a canonically verified receipt. The adapter is
> independently maintained in the Sub Rosa repository and does not modify
> Pollar core. This demonstrates developer-tooling interoperability; it is not
> presented as production adoption or transaction volume.
