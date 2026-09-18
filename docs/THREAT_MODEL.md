# Sub Rosa — Threat Model

## Assets

| Asset | Location | Sensitivity |
| --- | --- | --- |
| Bid value | Ciphertext (temporary storage) until R | High — market impact if early |
| Bid commitment H | On-chain persistent | Medium — binding once committed |
| Escrow | On-chain persistent | High — funds at stake |
| Bidder identity | Auditor blob (temporary) | Medium — selective disclosure |
| Drand round R | Round record | Public — coordination clock |
| Session mandate | Off-chain agent | Medium — caps delegation |
| Principal key | Off-chain | Critical — not used on-chain in agent flow |

## Adversaries

1. **Operator** — wants to learn bids early or bias clearing
2. **Competing bidder** — wants rival bids before R
3. **Keeper** — could censor reveals (liveness, not secrecy after R)
4. **Appraisal server** — could overcharge or return biased valuations
5. **Malicious agent** — tries to exceed mandate caps
6. **Auditor** — learns identities; must not learn bids before R if honest protocol followed

## Protections

### Early bid disclosure (operator / competitor)

| Threat | Mitigation | Residual |
| --- | --- | --- |
| Read ciphertext before R | tlock IBE — needs Drand round-R sig | None if Drand honest |
| Operator skips reveal | Permissionless `open_reveal_v2` plus keeper retries | Liveness relies on at least one caller after Drand R |
| Selective reveal one bid | Anyone can decrypt after R and submit each bidder's envelope; the ordered bidder set is public and capped at 25 | Reveals are separate transactions, not atomic; operators should run at least one keeper and monitor incomplete counts |

### Binding and fairness

| Threat | Mitigation | Residual |
| --- | --- | --- |
| Bid change after commit | Commitment H binds value+nonce | Overwrite allowed before deadline — by design |
| Bid size leaks through escrow | Partner Auction rounds require identical `fixed_escrow` from every bidder | The common cap itself is public; bid values reveal after R by design |
| Unauthorized participant | Optional on-chain allowlist checked by `commit_v2` | Open rounds intentionally admit any funded participant until the cap |
| Invalid high bid | `valid = value ≤ fixed_escrow` excludes from clearing | Escrow still locked until settle |
| Wrong clearing | Deterministic rule in contract | Operator sets rule at create_round |

### Funds

| Threat | Mitigation | Residual |
| --- | --- | --- |
| Winner doesn't pay | Escrow locked at commit; settle pulls from escrow | Requires valid reveal |
| Drand never delivers R | `void` after grace refunds all escrow | Grace window must be configured |
| Double settle | Idempotent settle skips settled bids | Proven in e2e |

### Identity privacy

| Threat | Mitigation | Residual |
| --- | --- | --- |
| Public learns bidder names | Identity only in auditor blob | Values public after reveal by design |
| Wrong auditor reads blob | X25519 AEAD to round auditor pubkey | Auditor key compromise exposes identities |

### Agent / mandate

| Threat | Mitigation | Residual |
| --- | --- | --- |
| Agent exceeds maxBid | Off-chain `assertBidWithinMandate` | **Not Soroban-enforced** — rogue agent could commit higher if funded |
| Agent overpays appraisal | `maxAppraisalSpend` off-chain | Same — requires honest agent code |
| Stolen session key | Caps limit damage to one round/mandate | Principal should rotate; passkey policies in production |

### Receipt verification

`@sub-rosa/sdk`'s offline `verifyReceiptV2` checks the canonical JSON export
against the round's commitments, clearing rule, and declared winner. The full
schema and verifier surface lives in `docs/RECEIPTS.md`; this subsection only
captures the threat-model-relevant surface.

| Threat | Mitigation | Residual |
| --- | --- | --- |
| Forged receipt | Verifier recomputes SHA-256 over each full canonical payload envelope, checks fixed escrow and eligibility policy, and derives the winner from the ordered valid set | Exporter can still lie about on-chain facts; consumers should cross-check against current ledger state |
| Tampered passphrase | `networkFingerprint = sha256(utf8(network))` is embedded in the receipt, so editing the claimed network invalidates the fingerprint | Operationally annoying but bounded — valid `null` ciphertext/auditorBlob after expiry is reported as a warning, not a failure |
| Recycled / replayed receipt | Core receipts are versioned (`version: 2`) and status-bound (`Cleared` / `Settled` / `Voided`); receipts are exported with the on-chain state at the time of export | A receipt can still be stale; re-export and reconcile before relying on it for high-value disputes |
| Single-exporter trust | Anyone can re-export the same round from the RPC and diff; idempotent settlement skips already-settled state, so two honest exporters converge | Forensic, not automatic; follow the evidence requirements in `docs/PILOT_PLAYBOOK.md` |

## Trust assumptions

1. **Drand quicknet** — honest threshold signing, public randomness
2. **Soroban host BLS** — correct implementation of BLS12-381 verify
3. **tlock-js / noble crypto** — correct seal/open implementation (tested)
4. **Agent software** — enforces mandate caps before submit
5. **USDC SAC** — standard SEP-41 behavior

## Out of scope (honest limits)

- Mandate caps are **not** enforced in the Round contract
- x402 appraisal price is not on-chain
- Passkey-Kit wallet demo is wired, but agent mandate enforcement is not moved to Passkey policies
- OZ Relayer Channels adapter is optional; direct RPC remains the proven critical path

## Auditor UI

The web **Auditor** tab demonstrates:

- Decrypting identity blobs with auditor secret (X25519)
- Live bid tlock decrypt after R via quicknet

This matches the selective-disclosure story: values public post-R, identities auditor-only.


### Owner-triggered opening

Protocol 3 optionally gates on-chain opening to the immutable operator until a
mandatory fallback. Drand publication still enables off-chain decryption for
anyone holding ciphertext, including that operator. Selective delay after seeing
outcomes is possible until fallback. The contract requires at least 300 seconds
between fallback and reveal deadline, verifies the BLS signature in both paths,
and rejects missing reveal-policy storage rather than treating it as Timed.
Opening after the deadline is rejected; permissionless void/refunds remain after
grace. See [policy specification](REVEAL_POLICY.md). This source change is not an
independent review or evidence of a new live deployment.
