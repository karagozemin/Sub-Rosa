# Known Limitations

Honest boundaries for the current protocol and pilot software. No hidden
fallbacks.

## Network scope

| Proof | Network | What it shows |
| --- | --- | --- |
| Keeper lifecycle (USDC, 2 bidders) | **Testnet** | `pnpm lifecycle:e2e` |
| Multi-agent + x402 + UI trace | **Testnet** | `pnpm agents:e2e` |
| Primitive v1 deploy + settle smoke | **Mainnet** | Historical proof; verify with `pnpm mainnet:legacy:verify` |
| Optional legacy v1 micro commit | **Mainnet** | `pnpm mainnet:legacy:micro` (dry-run default; tiny XLM only) |
| Core v2 deployment | **Mainnet** | Official capped deployment verified; lifecycle smoke remains a separate value-moving step |

The historical v1 mainnet smoke did **not** replay 700 / 459 USDC demo
amounts; it used **1 XLM bid / 5 XLM escrow** on native XLM SAC. The prepared
Core v2 capped smoke uses **0.01 XLM lot / 0.05 XLM bid / 0.10 XLM escrow**.

## Off-chain enforcement

- **Mandate caps** (`maxBid`, `maxAppraisalSpend`) are verified by agent software, not the Soroban contract.
- Partner Auction rounds enforce one shared **fixed escrow** and
  **bid ≤ fixed escrow** on-chain. Earlier Core v2 rounds may use variable caps.
- Optional participant eligibility is an explicit public allowlist, not private
  identity or KYC verification.
- A malicious or buggy agent could exceed mandate caps if funded — see `docs/THREAT_MODEL.md`.

## Not in critical path

- **OpenZeppelin Relayer Channels** — optional SDK submitter; all e2e scripts default to direct Soroban RPC.
- **Passkey-Kit** — UI demo + ecosystem docs; agents use Ed25519 session keys in this build.
- **Hosted appraisal API on mainnet** — x402 proof is testnet-only in automated e2e.

## Hosted UI trace

- **Single canonical trace** — `apps/web/src/demo/demo-trace.generated.ts`, written by `pnpm agents:e2e`.
- Covers agents → x402 → sealed commits → keeper reveal → clear → settle on one testnet contract.
- Optional live poll requires build-time `VITE_*` vars — see `docs/DEPLOY.md`.

## Receipt verification

Round receipts (`docs/RECEIPTS.md`) are **offline only** — the verifier checks internal consistency (commitment bindings, winner selection) but does **not** confirm the receipt matches current on-chain state. Trust the exporter; cross-check with multiple export runs.

## Operational

- Drand quicknet must publish round R for reveal to open; keeper can void after grace if R never arrives.
- Timed reveal opening is permissionless. The local protocol 3 extension also
  supports owner opening until a mandatory permissionless fallback; this does
  not extend off-chain privacy beyond Drand publication. Envelopes are decrypted and submitted
  in separate bounded transactions. At least one UI or keeper must finish the
  cohort; there is no single atomic reveal-all call.
- Temporary storage expires after the reveal window — seals are not kept forever by design.
- Mainnet WASM upload requires substantial XLM for resource fees; the observed
  Core v2 upload was `41.1615598 XLM` and should be simulated again before a
  future redeployment.

## Production boundary

- Core v2 has settled testnet proofs and an official capped Core v2 mainnet
  deployment, but no independent funds-handling audit yet.
- The published SDK does not make an arbitrary contract deployment safe; apps
  must pin the reviewed contract ID, network, and WASM hash.
- The legacy v1 mainnet round is protocol evidence, not a Core v2 production
  deployment.

See [pilot gaps](PILOT_GAPS.md) and the [new release plan](REVEAL_POLICY.md) for
remaining external integration and deployment work.
