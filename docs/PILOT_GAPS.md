# Pilot workflow review

Reviewed against the current adapter code and `docs/pilots/` boundaries. These
are explicitly scoped integration/operational follow-ups, not completed network
acceptance tests. Reliability work and Owner-Triggered implementation do not
turn these pilots into production partner integrations.

| Workflow | Current implementation | Remaining acceptance or integration work |
| --- | --- | --- |
| OpenX402 | `OPENX402_DISCOVERY_MODE = "fixture"`; adapter provides labeled discovery and optional payment handoff | Real provider discovery and partner-backed end-to-end payment/idempotency evidence |
| ACTA | Application validates issuer/credential before committing; outcome issuance uses ACTA adapter | Contract-verifiable credential eligibility and agreed issuer/API-key custody; current UI checks can be bypassed on open rounds |
| Trustless Work | Organizer selects a proposal; adapter prepares and optionally funds testnet escrow | Live acceptance with partner credentials, trustlines and signatures; milestone release remains in Trustless Work |
| Offer-Hub | Optional sealed-proposal workflow and browser-local workspace | Shared durable workspace and partner backend handoff; current selection is an application decision |
| Agent appraisal | Testnet appraisal/x402 lifecycle and embedded demo trace | Hosted mainnet appraisal service and live acceptance remain separate from fixture/demo playback |
| Receipt verification | Local verification of commitments and outcome; CLI supports legacy and structured receipts | Ledger-backed attestation remains external; exported metadata alone cannot prove on-chain authorization |
| Web payload size | Landing page is separate from deferred routes | Deferred crypto/SDK chunks remain large; measure each pilot route before a further dependency split |

Independent review of funds-handling and new deployment validation remain
external work. The release sequence and exact policy boundaries are in
[REVEAL_POLICY.md](REVEAL_POLICY.md).
