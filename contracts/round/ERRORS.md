# Sub Rosa Round — Contract Error Codes

Every failure mode from the Sub Rosa round contract has a defined code. There
is no silent fallback. This document maps each code returned (or reserved) by
the contract enum `Error` to:

- the contract entry point that produces it,
- the precise trigger condition,
- a user-facing message an SDK or wallet can display,
- the suggested next action an integrator or end user should take.

The numeric code is what surfaces on-chain (e.g. through
`soroban_sdk::Error::contract`); the variant name is the Rust identifier that
the SDK and bindings expose. **Both are part of the public API** and must
stay in sync with `contracts/round/src/types.rs`.

> Guardrail: no error codes are invented here. Every row corresponds to one
> variant of `enum Error` in [`src/types.rs`](src/types.rs). Every variant has
> an integration test in [`src/error_paths.rs`](src/error_paths.rs) that
> triggers the live return path (or, for deploy-only `AlreadyInitialized`,
> documents the constructor host boundary).

## Categories

| Range | Category |
| --- | --- |
| 1–4     | Initialization & state lookup |
| 10–22   | Lifecycle & timing |
| 30–45   | Cryptography, payload & partner policy validation |

## Initialization & state lookup (1–4)

| Code | Variant | Raised by | Trigger | User-facing message | Suggested next action |
| ---: | --- | --- | --- | --- | --- |
| 1 | `NotInitialized` | `get_config`, every contract function that reads `Config` | Storage read of `GlobalConfig` returned empty (instance key `Config` missing). | The round contract has not been deployed with its configuration. | Confirm the contract address you are calling; make sure the deploy transaction has finalized on the target network. |
| 2 | `AlreadyInitialized` | `__constructor` | A second deploy attempt hit a contract storage entry that already holds a `GlobalConfig`. | The round contract has already been configured. | Do not redeploy. Read the existing configuration via the `get_config` view. |
| 3 | `RoundNotFound` | `get_round`, every entry point that loads a `Round` record | Persistent storage has no `Round(id)`. | No round exists with that id on this contract. | Verify the round id. It may come from a different contract, network, or deployment. |
| 4 | `BidNotFound` | `get_state`, `reveal`, `settle` | Persistent storage has no `State(round_id, bidder_address)`. | That bidder has no bid on this round. | Confirm the bidder address and round id. The bidder may not have called `commit` yet, or may have committed on a different round. |

## Lifecycle & timing (10–22)

| Code | Variant | Raised by | Trigger | User-facing message | Suggested next action |
| ---: | --- | --- | --- | --- | --- |
| 10 | `CommitClosed` | `commit` | `env.ledger().timestamp() > round.commit_deadline`. | The commit window for this round has closed. | Do not retry. The operator must open a new round for new bidders. |
| 11 | `CommitNotClosed` | `open_reveal` | Time of the call is still on or before `commit_deadline`. | The reveal window cannot be opened before the commit window closes. | Retry `open_reveal` once `now > commit_deadline`. |
| 12 | `CommitDeadlineAfterReveal` | `create_round` | `commit_deadline >= time(R)` or `reveal_deadline <= time(R)`. | The commit or reveal deadline is not strictly inside the seal window `(now, time(R))`. | Set `commit_deadline` strictly before `time(R)` (Drand quicknet: `genesis + period × (round − 1)`). |
| 13 | `RevealNotOpen` | `reveal`, `clear` | `round.status != Status::Revealing`. | The reveal window has not been opened for this round yet. | Submit `open_reveal` with a verifiable Drand signature for round R. If Drand has not produced R yet, wait until `time(R) + grace`. |
| 14 | `RevealAlreadyOpen` | `open_reveal` | `round.status != Status::Open` (e.g. already Revealing, Cleared, Settled, Voided). | This round is past the commit phase. | No action — proceed to reveal, or call `clear` / `settle` as the lifecycle permits. |
| 15 | `RevealWindowClosed` | `reveal` | `env.ledger().timestamp() > round.reveal_deadline`. | The reveal window has closed for this round. | Do not retry the reveal. Any bid whose commit nobody successfully revealed stays marked `valid = false` and contributes no bid. After the deadline, anyone can call `clear`: if a valid reveal won, follow with `settle`; if no valid reveal existed, the round transitions to `Voided` and escrow is refunded via `void`/`refund_all` rather than `settle`. |
| 16 | `RevealStillOpen` | `clear` | `env.ledger().timestamp() <= round.reveal_deadline`. | The reveal window is still open; the round cannot be cleared yet. | Retry `clear` after `now > reveal_deadline`. |
| 17 | `NotCleared` | `settle` | `round.status != Status::Cleared`. | The round has not been cleared yet. | Call `clear` after `reveal_deadline`. If `clear` returned `Some(winner)` the round is now `Cleared` and `settle` is the right next step. If `clear` returned `None` the round has already transitioned to `Voided` with escrow refunded; do not call `settle` again — it will keep returning `NotCleared`. |
| 18 | `AlreadyCleared` | `clear`, `open_reveal` | `round.status == Status::Cleared`. | The round has already been cleared. | Do not retry `clear`. Call `settle` if a winner exists. |
| 19 | `AlreadySettled` | `settle`, `commit`, `reveal`, `open_reveal`, `void`, `clear` | `round.status == Status::Settled`. | The round has already been settled. | Settlement funds have already moved; do not retry. |
| 20 | `RoundVoided` | `void`, `commit`, `reveal`, `open_reveal`, `clear`, `settle` | `round.status == Status::Voided`. | The round has been voided. | All escrow has already been refunded; the round is terminal. |
| 21 | `NotVoidable` | `void` | Round is past the `Open` status, or `now <= reveal_deadline + VOID_GRACE` (3600 s). | The round cannot be voided from its current state, or the grace window has not elapsed yet. | Either complete the normal lifecycle, or wait until `reveal_deadline + 1 hour` and try `void` again. |
| 22 | `WrongStatus` | `commit` | `round.status != Status::Open`. | A bid can only be submitted to a round in the Open status. | Start a new round; a Revealing/Cleared/Settled/Voided round no longer accepts commits. |

## Cryptography & validation (30–43)

| Code | Variant | Raised by | Trigger | User-facing message | Suggested next action |
| ---: | --- | --- | --- | --- | --- |
| 30 | `InvalidDrandSignature` | `open_reveal` | BLS12-381 pairing check on `e(sig, -g2) · e(H(m), pk) == 1` returned false. | The Drand threshold signature did not verify on-chain. | Verify the signature source. Wait for the next Drand round, or re-fetch the signature from the official quicknet endpoint. Do not retry with a guessed signature. |
| 31 | `HashMismatch` | `reveal` | `sha256(be16(value) ‖ nonce) != state.commitment`. | The revealed bid does not hash to the committed commitment. | Re-derive `(value, nonce)` from the original sealing preimage that produced `H`. Reveal with the exact preimage; do not retry with arbitrary values. |
| 32 | `AlreadyRevealed` | `reveal` | `state.revealed_value.is_some()`. | A reveal has already been recorded for this bidder on this round. | No action — the recorded reveal stands. Repeated reveals are rejected on purpose to prevent front-running by a third party. |
| 33 | `PayloadTooLarge` | `create_round`, `commit` | One of: `auditor_pubkey.len() > 1024`, `ciphertext.len() > 4096`, `auditor_blob.len() > 2048`. | One of the submitted payloads is larger than the contract's size limit. | Shrink the offending payload: ciphertext ≤ 4096 B, auditor public key ≤ 1024 B, auditor blob ≤ 2048 B. |
| 34 | `InvalidAmount` | `create_round`, `create_round_v2`, `commit` | `reveal_round == 0`, `escrow <= 0`, or an `Auction` settlement config omits its payment asset, lot asset, or positive lot amount. | The amount or auction settlement configuration is invalid. | Use positive amounts. Auction rounds must name both SAC addresses and custody a positive lot amount. |
| 35 | `BidExceedsEscrow` | `reveal` | `value > state.escrow` after the commitment hash matches. | The revealed bid exceeds the escrowed amount. | Re-commit with escrow ≥ the sealed bid before the commit deadline, or reveal the exact committed value that fits under escrow. |
| 36 | `DeadlineInPast` | `create_round` | `commit_deadline <= now` (ledger time at submission). | The commit deadline is in the past. | Use a future timestamp; check ledger time at submission, since Drand round R must be strictly after `commit_deadline`. |
| 37 | `NoValidBids` | `settle` | `round.winner` is `None` on a round whose status is `Cleared`. | Round has no winner to settle against. | Investigate: under current behavior the contract transitions to `Voided` (with all escrow refunded) when no valid bid is revealed, so this code should not appear in normal flow. If it does, the round is in an inconsistent state and warrants a manual review. |
| 38 | `RoundFull` | `commit` | `round.bidders.len() >= MAX_BIDDERS` (500). | The round has reached its bidder cap. | Start a new round to accept further bidders. |
| 39 | `InvalidLimit` | `get_bidders_page` | `limit == 0` or `limit > 100`. | Page size must be between 1 and 100 (inclusive). | Pass a `limit` in `[1, 100]`; use `next_cursor` from the previous page to walk larger rounds. |
| 40 | `UnsupportedVersion` | `commit_v2`, `reveal_v2` | Stored Core version or payload envelope version is not supported by this deployment. | This round or submission uses an unsupported protocol version. | Use Core v2 with payload envelope v1, or target a deployment that supports the requested version. |
| 41 | `MalformedPayload` | `reveal_v2` | Envelope magic, flags, reserved bytes, declared length, canonical zero fields, or required auction amount is invalid. | The revealed structured payload is malformed or non-canonical. | Re-open the original ciphertext with `@sub-rosa/tlock` and submit the exact canonical envelope bytes. |
| 42 | `EscrowNotAllowed` | `create_round_v2`, `commit_v2`, `reveal_v2` | A `ReceiptOnly` round configured payment/lot settlement or received non-zero escrow. | Receipt-only rounds do not accept or move assets. | Omit settlement assets and submit with `escrow = 0`, or create an `Auction` round when atomic settlement is required. |
| 43 | `RoundDurationTooLong` | `create_round_v2` | `reveal_deadline - now` exceeds the supported 30-day Core v2 duration. | The requested round duration exceeds the supported storage and liveness window. | Choose deadlines within 30 days of the creation ledger timestamp. |
| 44 | `ParticipantNotEligible` | `commit_v2` | The round has a non-empty participant allowlist and the bidder is not included. | This address is not eligible for the round. | Connect an allowlisted wallet or ask the organizer to create a new round with the correct participant list. |
| 45 | `EscrowPolicyMismatch` | `commit_v2` | An auction created with a partner policy received an escrow amount different from the round's fixed public cap. | Every bidder must lock the same escrow cap for this auction. | Read `get_round_policy_v2` and submit exactly its `fixed_escrow` amount. |
| 46 | `InvalidRevealPolicy` | `create_round_v3` | Fallback is not after Drand time or leaves less than 300 seconds before reveal deadline. | Invalid owner opening window. | Choose fallback after Drand time and reveal deadline at least 300 seconds later. |
| 47 | `RevealPolicyMissing` | `get_reveal_state_v3`, `open_reveal_v2` | Required v3 reveal state is missing. | Opening policy is unavailable. | Restore archived policy state; never infer permissionless opening from missing data. |

## How to use this table

- **SDK mapping**: [`packages/sdk/src/errors.ts`](../packages/sdk/src/errors.ts)
  wraps SDK-level failures. A future enhancement is to surface the contract
  error code alongside the `SubRosaSubmitError` to enable this table as the
  UI hint layer.
- **Receipt interpretation**: A round receipt that fails to verify should
  include the contract error code from the failing transaction. Use this
  table verbatim for the user-facing note.
- **Keeper triage**: The keeper daemon ([`services/keeper`](../services/keeper))
  classifies the error from a thrown call as either transient (retry later),
  terminal (skip the round), or config (alert). The "Trigger" column is the
  authoritative input for that classifier.

## Cross-references

- Source enum: [`contracts/round/src/types.rs`](src/types.rs)
- Entry points that produce errors: [`contracts/round/src/lib.rs`](src/lib.rs)
- Storage-layer error mapping: [`contracts/round/src/storage.rs`](src/storage.rs)
- Integration guide: [`docs/INTEGRATION.md`](../docs/INTEGRATION.md)
- Technical design and storage TTLs: [`docs/TECH_DESIGN.md`](../docs/TECH_DESIGN.md)
- Threat model: [`docs/THREAT_MODEL.md`](../docs/THREAT_MODEL.md)
