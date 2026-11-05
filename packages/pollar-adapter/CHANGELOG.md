# Changelog

## 0.1.0 — unreleased

- Add an optional Pollar 0.12 signer bridge for Sub Rosa SDK 0.3.x.
- Enforce testnet, classic G-address, self-paid and ReceiptOnly boundaries.
- Validate transaction XDR, body integrity, source account and Ed25519 signature.
- Validate Soroban auth-entry address, invocation tree and live-ledger expiry.
- Handle wallet provisioning, network mismatch, fee bump, manual co-sign and
  Pollar policy errors explicitly.
- Add a real-Pollar ReceiptOnly lifecycle harness and release evidence template.

Release remains blocked until the real Pollar-signed testnet lifecycle produces
public transaction hashes and a verified canonical receipt.
