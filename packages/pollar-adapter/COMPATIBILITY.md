# Compatibility report

Validated against `@pollar/core@0.12.0`, `@sub-rosa/sdk@0.3.2`, and
`@stellar/stellar-sdk@15.1.0` on 2026-11-05.

## Supported

- Pollar internal or external classic Stellar G-address wallets.
- Pollar `signTx` with `skipSponsorship: true`.
- Pollar `signAuthEntry` with expiration derived from live testnet ledger data.
- Sub Rosa Core v2/v3 ReceiptOnly creation and zero-escrow submissions.
- Existing Sub Rosa open, reveal, clear, export and receipt-verification APIs.

## Deliberately unsupported

- Mainnet and real funds.
- Smart/passkey C-address wallets; these require Pollar's combined submit flow.
- Sponsored fee-bump envelopes.
- Auction mode, positive escrow, Auction lifecycle writes and legacy v1 round
  creation. Existing round mode is checked before v2 lifecycle writes.
- Calling Pollar `submitTx` or `signAndSubmitTx` from the adapter.

## Required adaptations

- Pollar returns `{ status: "signed", signedXdr }`; Sub Rosa expects
  `{ signedTxXdr, signerAddress }`. The adapter validates and normalizes it.
- Pollar auth signing requires `validUntilLedger`; the Stellar contract callback
  does not supply it. The adapter obtains the current ledger from testnet RPC.
- Pollar can return `cosign_pending`; this is surfaced as a typed error instead
  of being treated as a completed signature.
- External Pollar wallets may choose their own auth-entry expiry. It is accepted
  only when the signed entry stays within the adapter's bounded live-ledger
  window.

## External status

Oscar's arbitrary Soroban signing capability confirmation is recorded as
partner evidence. Actual interoperability is still release-gated on a READY,
authenticated Pollar testnet session completing the reproducible lifecycle.
No such session or Pollar API credential is present in this workspace, so no
transaction hash or receipt is claimed yet.

The repository includes `examples/pollar-e2e`, which uses Pollar's real browser
session, DPoP key manager, email/OAuth/classic-wallet login and confirmation
callbacks. It never serializes the client or exports its session material.
