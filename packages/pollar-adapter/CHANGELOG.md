# Changelog

## 0.1.0 — unreleased

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
  separate Pollar application-policy gate for standalone auth-entry signing.

Release remains blocked pending the live standalone auth-entry proof, explicit
release authorization, and removal of `private: true`. The transaction-signing
lifecycle itself is verified with public hashes and a canonical receipt.
