# SCF #46 — Pollar × Sub Rosa integration evidence

Last updated: 2026-11-06

## Current evidence level

**Live Pollar transaction signing and standalone Soroban auth-entry signing are
both verified on Stellar testnet; `@sub-rosa/pollar-adapter@0.1.0` is published
with public npm access.**

- Initial implementation commit: https://github.com/karagozemin/Sub-Rosa/commit/03cb8ec
- Merged implementation and review: https://github.com/karagozemin/Sub-Rosa/pull/1
- Merge commit: https://github.com/karagozemin/Sub-Rosa/commit/75868f313e757f1070660744fdd3e2270cd91b28
- npm package: https://www.npmjs.com/package/@sub-rosa/pollar-adapter/v/0.1.0
- release tag: https://github.com/karagozemin/Sub-Rosa/releases/tag/pollar-adapter-v0.1.0

This document deliberately distinguishes implementation from validation,
publication, listing, and adoption. A local unit test is not a Pollar-signed
testnet transaction.

| Stage | Status | Evidence |
|---|---|---|
| Proposed integration | Confirmed | Alejandro requested an optional community adapter maintained in the Sub Rosa repo/npm scope. Preserve the original message before public use. |
| Arbitrary Soroban SDK capability | Confirmed in writing | User reports Alejandro confirmed with Oscar that Pollar supports arbitrary Soroban contract transaction signing without restrictions. Preserve the original confirmation before quoting it publicly. |
| Working local adapter | Implemented | `packages/pollar-adapter`, real `@pollar/core@0.12.0` and `@sub-rosa/sdk` types, automated tests and pack validation. |
| Real Pollar testnet lifecycle | Verified | Round 33 completed through the interactive runner with the authenticated READY Pollar G-address below. All five hashes independently resolve to successful Stellar testnet transactions. |
| Standalone `signAuthEntry` | Verified | Pollar signed the non-source wallet authorization, a distinct transient account signed the envelope, enforce-mode simulation passed, and Round 35 succeeded in ledger 5579176. |
| Public community package | Published | Version `0.1.0` is public on npm; registry metadata, tarball integrity, clean installation and both documented exports were verified after publication. |
| Pollar developer listing | Verified | Pollar's official [community integrations guide](https://docs.pollar.xyz/docs/guides/community-integrations#sub-rosa-adapter) lists the Sub Rosa-maintained adapter, package, source, and testnet/ReceiptOnly scope. |
| Independent production adoption | Not claimed | A testnet adapter is not customer adoption or economic volume. |

## Supported `0.1.0` scope

- Stellar testnet only; mainnet is rejected.
- Ready classic Pollar `G...` wallets only; smart/passkey `C...` wallets are
  rejected.
- Sub Rosa ReceiptOnly rounds with zero escrow only; Auction/escrow flows are
  rejected.
- Pollar `signTx` and standalone non-source `signAuthEntry` callbacks, with an
  exact application contract/function allowlist for auth-entry signing.
- Self-paid transaction envelopes only; fee-bump/sponsored envelopes are
  rejected in this release.
- Optional, application-selected integration through peer dependencies; no
  changes to Pollar core or automatic activation in existing applications.

## Published package verification

- Package: `@sub-rosa/pollar-adapter@0.1.0`
- npm dist-tag: `latest -> 0.1.0`
- Public tarball: `https://registry.npmjs.org/@sub-rosa/pollar-adapter/-/pollar-adapter-0.1.0.tgz`
- Tarball SHA-512 integrity:
  `sha512-g0xBtwi6wRVLA+3sB+A+sPzII1BZlqUpZNhuFoFbvHWs9C3o6ZZPYLJpg3eCm3NHQlzhEEuxEpW1N5Dojl2NIw==`
- Clean install by package name succeeded with Pollar `0.12.0` and Sub Rosa SDK
  `0.3.2`; both the root adapter export and `./testnet` export imported
  successfully.
- The 18-file public tarball contains compiled JavaScript/types, README,
  compatibility notes, changelog, MIT license and the testnet example. It does
  not contain local environment files, Pollar credentials, DPoP/session data,
  sponsor secrets or raw signed payloads.
- A post-install npm audit reports inherited advisories through the current
  Stellar SDK dependency chain (`axios` and `toml`) and reports no automatic
  fix. This is recorded as an upstream dependency follow-up, not presented as a
  new adapter-code finding or silently omitted.

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
- Stellar authorization-preimage to Pollar full-entry adaptation, plus
  live-ledger expiry, invocation, nonce, address and Ed25519 signature checks.
- Explicit handling for `cosign_pending` and backend policy failures.
- Fresh post-signature enforce-mode simulation, sequence/resource/footprint/fee
  refresh, separate envelope-signature verification, and raw RPC rejection
  decoding without blind resubmission.
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
| `pnpm --filter @sub-rosa/pollar-adapter test` | PASS — 19/19 |
| `pnpm --filter @sub-rosa/pollar-adapter build` | PASS |
| `pnpm pollar-e2e:build` | PASS — interactive browser runner |
| `npm publish --dry-run --access public` from adapter package | PASS — 18-file public release manifest validated |
| `pnpm --filter @sub-rosa/sdk test` | PASS — 204/204 |
| `pnpm -r --if-present test` | PASS — all 11 test-bearing workspace projects |

## Original live ReceiptOnly proof — Round 33 preserved

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
Sub Rosa Soroban transactions. It remains preserved as the original proof and
is independent of the later standalone `signAuthEntry` transaction.

## Latest ReceiptOnly regression proof — Round 34

After Pollar's protocol-30 backend update, the same authenticated Pollar wallet
completed a second five-write ReceiptOnly lifecycle. The harness verified the
canonical receipt and all five hashes independently resolved to `SUCCESS`:

| Operation | Stellar testnet transaction | Ledger | RPC status |
|---|---|---:|---|
| Create ReceiptOnly round | [`d919d8093700df3738a46fc6e5645663917ce800aa4bd86146748bfcda70724e`](https://stellar.expert/explorer/testnet/tx/d919d8093700df3738a46fc6e5645663917ce800aa4bd86146748bfcda70724e) | 5579072 | SUCCESS |
| Sealed commit | [`8b9fccf312b20e0038fbd91d1c9a5756fdf26073629d970511d51c8f2131ed52`](https://stellar.expert/explorer/testnet/tx/8b9fccf312b20e0038fbd91d1c9a5756fdf26073629d970511d51c8f2131ed52) | 5579077 | SUCCESS |
| Open reveal | [`73f75b1392af4b7a945b2c75695969894246b1b147cdc1657feec54cd544cd5c`](https://stellar.expert/explorer/testnet/tx/73f75b1392af4b7a945b2c75695969894246b1b147cdc1657feec54cd544cd5c) | 5579115 | SUCCESS |
| Reveal | [`d69677597ab9a0ab92effd52c469a33dccef31b57d9c69d9408a4329d37c96f7`](https://stellar.expert/explorer/testnet/tx/d69677597ab9a0ab92effd52c469a33dccef31b57d9c69d9408a4329d37c96f7) | 5579119 | SUCCESS |
| Clear | [`a7eb61b48b08147d0c1fa2feeed33e51c61473281da0ba9c7a4284e769060add`](https://stellar.expert/explorer/testnet/tx/a7eb61b48b08147d0c1fa2feeed33e51c61473281da0ba9c7a4284e769060add) | 5579153 | SUCCESS |

- Round ID: `34`
- Canonical receipt SHA-256:
  `c3c446ec0832894344a1e609049d4d39eb1c58fcdbc08087563fdb34bf8cfb3a`
- `verifyReceiptV2(...).valid`: `true`

## Standalone authorization-entry verification — Round 35

The least-privilege Pollar application allowlist contains only the Sub Rosa
testnet contract and `create_partner_round_v2`; no wildcard or token contract
permission was added. A Friendbot-funded transient G-address paid the fee and
signed the transaction envelope. The authenticated Pollar wallet separately
signed the Soroban address authorization entry as the non-source operator.

| Field | Verified value |
|---|---|
| Pollar authorizer | `GCGHLZRGDAOFKUWPCKOG3OIC62ZEHAFM6AKIWJGRLRIX7OIAJT36AGL3` |
| Envelope source/sponsor | `GDYWMF5WUQASUEXU3JVD7AAQERF4QJMAWUKSU4B3F7PBJMFSAKKDUJSI` |
| Contract | `CCOVGOQQZJKZ2R55GRWBLTJTGBAMSHXZVN3ICPG3WRVMLMM6RHISC5OV` |
| Function | `create_partner_round_v2` |
| Auth nonce | `8843141292032622291` |
| Latest ledger at signing | `5579170` |
| Valid until ledger | `5579250` |
| Submitted at ledger | `5579175` |
| Included ledger / result | `5579176` / `txSuccess` |
| Returned round | `35` |

Transaction:
[`a1c56b0c2d206c7aafd0d4b16e46596f4ac6e4f05ea90c565787c565c6810fda`](https://stellar.expert/explorer/testnet/tx/a1c56b0c2d206c7aafd0d4b16e46596f4ac6e4f05ea90c565787c565c6810fda)

Independent verification against Stellar testnet RPC confirmed:

- RPC status `SUCCESS`, decoded transaction result `txSuccess`, and envelope
  hash equal to the public transaction hash.
- Exactly one `invokeHostFunction` operation targeting the contract/function
  above and exactly one address-credential auth entry.
- Auth address/public key equal to the Pollar G-address; nonce, invocation tree,
  testnet network ID and ledger expiration bound into the signed preimage.
- Pollar Ed25519 authorization signature cryptographically valid.
- Transaction source equal to the transient sponsor and its separate envelope
  Ed25519 signature cryptographically valid.
- Soroban transaction data present after a fresh enforce-mode simulation; fee
  `1210615`, sequence `23962352688824321`, and return value Round `35`.

The public machine-readable record is
[`docs/evidence/pollar-auth-entry-round-35.json`](evidence/pollar-auth-entry-round-35.json).
No Pollar session token, DPoP key, publishable key, sponsor secret, raw signed
payload, or private signing material is included.

### Earlier authorization attempts — chronology preserved

On 2026-11-05 the browser runner constructed a genuine non-invoker Soroban
authorization flow: a Friendbot-funded transient G-address was the transaction
source and fee payer, while the authenticated Pollar wallet was the Sub Rosa
`create_partner_round_v2` operator. Simulation produced a distinct address
authorization entry for the Pollar wallet. The runner bound it to Stellar
testnet, requested expiration at ledger `5565008`, and called the real
`@pollar/core@0.12.0` `signAuthEntry` method using the existing authenticated
client. No private-key fallback or second wallet could authorize that entry.

Pollar returned HTTP 403:

```text
code: SOROBAN_AUTH_NO_POLICY
message: no Soroban auth-entry allowlist is configured for this application
applicationId: cmw2xdouj00010itcvg44jdl0
applicationName: subrosa
```

No Stellar transaction was submitted and there is no auth-entry transaction
hash to report. This establishes that authentication, wallet selection,
simulation, network binding, XDR construction, live-ledger lookup and the real
Pollar API path were reached. It does not establish a successful live signature.
The response classifies the blocker as Pollar application policy, not account,
network, signer, malformed XDR, or Stellar submission.

Least-privilege configuration required for the rerun:

- network: Stellar testnet
- application: `cmw2xdouj00010itcvg44jdl0` (`subrosa`)
- contract: `CCOVGOQQZJKZ2R55GRWBLTJTGBAMSHXZVN3ICPG3WRVMLMM6RHISC5OV`
- function: `create_partner_round_v2`
- allow an 80-ledger authorization lifetime

No wildcard contract or function permission is requested. After Pollar applies
this policy, the same browser button can sign, cryptographically verify, submit,
and export the separate on-chain evidence record without changing Round 33.

### Retry after self-serve policy configuration

The project configured exactly the contract/function tuple above in Pollar's
self-serve dashboard, with no wildcard or token-contract permissions. The next
live request passed the former allowlist gate and reached Pollar's embedded
signer, which returned:

```text
code: SOROBAN_AUTH_SIGN_FAILED
message: unknown StellarValueType member for value 3
```

The Pollar team identified this as its backend ledger-header decoder failing
after Stellar testnet moved to a newer protocol version, and reported that it is
updating the signer. This is consistent with the protocol-30 header-XDR issue
independently observed in this repository. The adapter already avoids decoding
the header for expiry calculation and reads only the JSON-RPC ledger sequence;
the remaining exception occurs inside Pollar after the request leaves the
browser. The operator-provided dashboard log URL requires an authenticated
Pollar dashboard session and is not treated here as public evidence.

No signed authorization entry was returned during that attempt and the
transient sponsor submitted nothing. Pollar subsequently deployed its decoder
fix, after which the fresh Round 35 proof above succeeded. Round 33 and its five
original transaction hashes remain unchanged.

## Remaining follow-up

1. Preserve Pollar's official
   [community integrations listing](https://docs.pollar.xyz/docs/guides/community-integrations#sub-rosa-adapter)
   as the primary public evidence. The page identifies the adapter as
   community-maintained and does not imply Pollar core ownership or support.
2. Track fixes for the inherited Stellar SDK dependency advisories noted above
   and update through a separately tested patch release when compatible fixes
   are available.

## SCF wording supported by the live proof

> Sub Rosa maintains an optional Pollar community adapter that lets a classic
> Pollar Stellar wallet execute Sub Rosa ReceiptOnly sealed rounds. The public
> testnet proof includes the create, sealed commit, Drand-gated open, reveal and
> clear transaction hashes plus a canonically verified receipt. The adapter is
> independently maintained in the Sub Rosa repository and does not modify
> Pollar core. This demonstrates developer-tooling interoperability; it is not
> presented as production adoption or transaction volume.

> A separate public testnet transaction verifies standalone Pollar
> `signAuthEntry`: the Pollar G-address authorized the Sub Rosa contract call as
> non-source operator while an unrelated transient account signed and paid the
> envelope. Both signatures and the on-chain Round 35 result were independently
> verified.
