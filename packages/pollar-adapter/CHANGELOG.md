# Changelog

## 0.1.0 — 2026-11-06

- Add an optional Pollar 0.12 signer bridge for Sub Rosa SDK 0.3.x.
- Enforce testnet, classic G-address, self-paid and ReceiptOnly boundaries.
- Validate transaction XDR, body integrity, source account and Ed25519 signature.
- Validate Soroban auth-entry address, invocation tree and live-ledger expiry.
- Handle wallet provisioning, network mismatch, fee bump, manual co-sign and
  Pollar policy errors explicitly.
- Add a real-Pollar ReceiptOnly lifecycle harness and release evidence template.
- Add a browser-safe `./testnet` lifecycle export and a local interactive Pollar
  OTP/OAuth/classic-wallet runner with explicit signature approval.
- Add a real non-source-operator `signAuthEntry` testnet runner with a transient
  fee sponsor, pre-submission signature verification, and separate evidence.
- Adapt Stellar SDK authorization-preimage callbacks to Pollar's full-entry API
  and cryptographically verify signer, nonce, invocation, expiration and
  Ed25519 signature.
- Read the latest ledger sequence without decoding protocol 30 ledger-header XDR.
- Record the successful Pollar-signed Round 33 ReceiptOnly lifecycle and the
  separate live standalone auth-entry attempts: the self-serve policy gate was
  cleared, Pollar fixed its newer-protocol ledger-header decoder, and the final
  Pollar-signed non-source authorization created Round 35 on testnet.
- Refresh source sequence, resources, footprint and fee through enforce-mode
  simulation after auth signing; validate the distinct auth-entry and envelope
  signatures before one-time submission.
- Preserve raw `sendTransaction` rejection fields and decode transaction and
  operation result codes instead of reporting the UI's generic `UNKNOWN` fallback.

Both live transaction signing and standalone auth-entry signing are verified.
The package metadata and tarball are prepared; registry publication remains
pending explicit release authorization.
