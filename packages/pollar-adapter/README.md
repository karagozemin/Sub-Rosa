# `@sub-rosa/pollar-adapter`

Optional community adapter connecting a ready Pollar Stellar wallet to the
existing Sub Rosa SDK. The first release target is deliberately narrow:

- Stellar testnet only
- classic `G...` accounts only
- Sub Rosa `ReceiptOnly` rounds only
- self-paid transactions (`skipSponsorship: true`)
- no changes to Pollar core and no automatic activation

The package is currently release-gated (`private: true`) until a real Pollar
account completes the published testnet lifecycle and the resulting hashes are
recorded. Unit tests are not presented as integration proof.

## Install

After the release gate is cleared:

```bash
pnpm add @sub-rosa/pollar-adapter @pollar/core @sub-rosa/sdk
```

`@pollar/core` and `@sub-rosa/sdk` are peer dependencies. The adapter does not
add Pollar to applications that do not opt in.

## Usage

```ts
import { PollarClient } from "@pollar/core";
import { createPollarSubRosaClient } from "@sub-rosa/pollar-adapter";

const pollar = new PollarClient({
  apiKey: "pk_...",
  stellarNetwork: "testnet",
});

await pollar.ready();
// Complete the application's normal Pollar login flow first.

const { client, signer } = createPollarSubRosaClient({ pollar });
console.log(signer.publicKey);

// Existing @sub-rosa/sdk APIs now use the Pollar signing callbacks.
// const roundId = await createSealedProposalRound(client, ...);
```

The adapter calls `PollarClient.signTx`, never `signAndSubmitTx` or `submitTx`.
Sub Rosa submits the signed envelope exactly once through its normal RPC path.

## Validation performed on every signature

- Pollar is still on testnet and the active wallet has not changed.
- The wallet is a ready, on-ledger classic Stellar account.
- The callback network passphrase is the Stellar testnet passphrase.
- Unsigned and signed transaction XDR both parse successfully.
- Fee-bump envelopes are rejected in the initial release.
- The signed transaction body hash is identical to the unsigned body hash.
- The source account and Ed25519 signature match the active Pollar wallet.
- Soroban authorization entries retain the same address and invocation tree.
- Authorization expiry is requested from the latest testnet ledger (default
  +100); an external Pollar wallet may choose a different expiry, which is
  accepted only inside a bounded live-ledger window.
- `cosign_pending` and Pollar policy failures are explicit errors.

Pollar's embedded auth-entry path can enforce application contract/function
policy. A rejection is preserved as `PollarAdapterError`, including Pollar's
backend error code when supplied. Oscar confirmed to the project team that
arbitrary Soroban contract transactions are supported; the live test remains
the release criterion.

## Live ReceiptOnly proof

The reproducible harness is
[`examples/receipt-only.testnet.ts`](./examples/receipt-only.testnet.ts). It
requires a real, already-authenticated `PollarClient` exported from a local
untracked module:

```bash
POLLAR_SESSION_MODULE=/absolute/path/to/pollar-session.mjs \
  pnpm --filter @sub-rosa/pollar-adapter test:e2e -- --run
```

The harness creates a Pollar-signed ReceiptOnly round, commits a sealed
proposal, waits for Drand, opens, reveals, clears, verifies the canonical
receipt, and prints each public testnet transaction hash. It rejects substitute
signers and contains no secret-key fallback.

## Development

```bash
pnpm --filter @sub-rosa/pollar-adapter typecheck
pnpm --filter @sub-rosa/pollar-adapter test
pnpm --filter @sub-rosa/pollar-adapter build
cd packages/pollar-adapter && npm pack --dry-run
```

## Limitations and security

- Do not use this release candidate on mainnet or with real funds.
- Smart/passkey `C...` accounts require Pollar's combined submit ceremony and
  are intentionally rejected.
- Sponsored fee-bump envelopes are intentionally rejected; the Pollar account
  must have testnet XLM for fees.
- Never commit Pollar API keys, session tokens, session modules, proposal
  plaintexts, or raw signed payloads.
- A successful testnet proof establishes technical interoperability, not
  production adoption, transaction volume, or an official Pollar product.

## Troubleshooting

- `POLLAR_WALLET_NOT_READY`: wait for `onWalletStateChange` to report `READY`.
- `POLLAR_NETWORK_MISMATCH`: create/configure the Pollar client for `testnet`.
- `POLLAR_COSIGN_PENDING`: approve the request through the application's Pollar
  co-sign UI, then retry with an automatically settled signing configuration.
- `POLLAR_SIGNING_REJECTED`: inspect `pollarCode`; for embedded wallets confirm
  the Sub Rosa contract/functions are enabled by the Pollar application policy.
- `FEE_BUMP_UNSUPPORTED`: keep `skipSponsorship: true` and fund the testnet
  Pollar account; the initial adapter does not unwrap sponsored envelopes.
