# Compatibility report

Validated against `@pollar/core@0.12.0`, `@sub-rosa/sdk@0.3.2`, and
`@stellar/stellar-sdk@15.1.0` on 2026-11-05.

## Supported

- Pollar internal or external classic Stellar G-address wallets.
- Pollar `signTx` with `skipSponsorship: true`.
- Pollar `signAuthEntry` callback adaptation with expiration derived from live
  testnet ledger data. Live backend signing additionally requires the Pollar
  application's Soroban auth-entry allowlist.
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
- Pollar accepts a complete unsigned authorization entry and returns a complete
  signed entry. Stellar SDK's callback instead supplies a network-bound
  authorization preimage and consumes raw signature bytes. The adapter performs
  that conversion and verifies the returned Ed25519 signature.
- Pollar auth signing requires `validUntilLedger`. The adapter checks the
  callback's requested expiration against the current testnet ledger and a
  bounded maximum before sending it to Pollar.
- The current testnet RPC uses protocol 30 header XDR that stellar-sdk 15.1.0
  cannot fully decode. Ledger-expiration reads therefore parse only the numeric
  `getLatestLedger.result.sequence` JSON field.
- Pollar can return `cosign_pending`; this is surfaced as a typed error instead
  of being treated as a completed signature.
- External Pollar wallets may choose their own auth-entry expiry. It is accepted
  only when the signed entry stays within the adapter's bounded live-ledger
  window.

## External status

Oscar's arbitrary Soroban transaction-signing capability confirmation is
recorded as partner evidence. A READY authenticated Pollar G-address completed
the full ReceiptOnly lifecycle in Round 33, proving live `signTx` interoperability.

The standalone auth-entry runner reached Pollar's real `/tx/sign-auth-entry`
endpoint with a valid simulated Sub Rosa invocation. The initial request exposed
a missing application allowlist. After the exact testnet contract/function tuple
was configured through Pollar's self-serve dashboard, the next request passed
that gate but returned `SOROBAN_AUTH_SIGN_FAILED: unknown StellarValueType member
for value 3`. Pollar identified its backend ledger-header decoder as incompatible
with the newer Stellar testnet protocol and is updating it. No auth-entry
transaction was submitted. The adapter already obtains the ledger sequence
without decoding the protocol-30 header XDR.

The repository includes `examples/pollar-e2e`, which uses Pollar's real browser
session, DPoP key manager, email/OAuth/classic-wallet login and confirmation
callbacks. It never serializes the client or exports its session material.
