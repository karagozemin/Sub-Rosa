# Sub Rosa — Security Office Hours Context

Use this document as the concise source of truth during the Runtime Verification
Stellar Security Office Hours session. Keep spoken answers short (normally one
to three sentences), distinguish deployed versions carefully, and do not claim
that Sub Rosa is audited or production-ready for uncapped value.

## Session objective

This is a working security conversation, not an audit or a request for a
security verdict. The goal is to:

1. challenge the protocol's security assumptions;
2. identify the highest-priority design and audit-readiness gaps;
3. learn which properties should be fuzzed or formally specified; and
4. leave with a prioritized list of concrete next actions.

## Two-minute protocol overview

Sub Rosa is sealed-round infrastructure on Soroban with two modes:

- `Auction`: bidders lock identical fixed escrow, the seller deposits a lot,
  the contract selects the highest or lowest valid revealed bid, pays the
  seller, refunds unused and losing escrow, and transfers the lot atomically.
- `ReceiptOnly`: participants submit confidential structured proposals, the
  contract finalizes the revealed set and a verifiable receipt, and no assets
  move through Sub Rosa.

The lifecycle is:

```text
create round
  -> participant commits H(envelope) + tlock ciphertext (+ escrow for Auction)
  -> Drand round R is published
  -> open reveal after on-chain BLS verification
  -> reveal each participant's envelope in a separate transaction
  -> clear after the reveal deadline
  -> Auction: settle payment, refunds, and lot transfer
     ReceiptOnly: finalize the revealed submission set
  -> if opening never happens: permissionless void/refund after grace
```

The operator configures a round. Drand defines the public decryption boundary.
Reveal, clear, settle, and eligible refund/void progression are permissionless
once their respective gates have been crossed. Operational liveness still
requires at least one caller to submit the transactions.

## Exact review scope and deployed artifacts

Do not describe "the deployed contract" without naming the version and network.

| Scope | Network | Contract | WASM SHA-256 | Status |
| --- | --- | --- | --- | --- |
| Core v2 | Mainnet | `CDQOFNCJE5Z4ZZL76DU5652FOUKJVEIZWHFGCZVWH63UYBGPSZIPC325` | `2c7bc6b4c91940ac185df38a3d0a8532b555140d818df94f03f894e5952ebf42` | Capped deployment; not independently audited for uncapped value |
| Protocol v3 | Testnet | `CB7VIYY4RQLZG2Y6HLDWB3UKSVOAIDYFZ5TGW5AUBCIPJHTCZV4ZWQFF` | `7a72a82c2678eccaa2f6f3727d4d972640cbabc54f04124c6fc8b68bf150b194` | Separate testnet candidate with live lifecycle evidence; mainnet promotion pending |

Current repository HEAD at session preparation time:

```text
04a4dc574ff36bbd8737c4a290f22d19a38357e1
```

A clean build from this HEAD reproduced the v3 testnet WASM hash
`7a72a82c...b194`. The historical v3 release manifest records revision
`375129ac...` with `workingTreeDirty: true`; this should be treated as release
provenance/handoff cleanup, not as proof of a current source/WASM mismatch.

## Current verification evidence

- The Round contract suite currently passes **108/108 tests**.
- Covered behavior includes lifecycle transitions, real Drand verification
  vectors, deadline boundaries, commitment mismatch rejection, fixed escrow and
  allowlists, settlement and refunds, token conservation, zero contract balance
  after terminal Auction paths, and protocol-v3 owner/fallback behavior.
- Live testnet evidence exists for v3 owner opening, outsider rejection,
  permissionless fallback, Auction settlement, and loser refund.
- There is no claim of independent audit, formal verification, or comprehensive
  fuzzing.
- Existing live runs do not constitute a worst-case 25-participant resource
  benchmark.

Tests are evidence that known cases behave as intended. They are not evidence
that the threat model is complete.

## Primary security question: ciphertext-to-commitment binding

### Current behavior

At `commit_v2`, the contract stores two independent objects:

- persistent `commitment = SHA-256(canonical envelope)`; and
- temporary tlock `ciphertext` supplied by the bidder.

At `reveal_v2`, the contract hashes the submitted plaintext envelope and checks
it against the stored commitment. It does **not** prove that the stored
ciphertext encrypted that envelope. Correct tlock encryption is therefore an
off-chain construction assumption.

After the reveal deadline, `clear_v2` considers only valid revealed envelopes.
An unrevealed Auction participant is skipped during winner selection and their
escrow is normally refunded during settlement.

### Attack hypothesis to ask RV to evaluate

A malicious bidder may be able to:

1. commit `H(envelope)` while submitting malformed ciphertext or ciphertext for
   a different plaintext;
2. retain the committed envelope locally;
3. wait until Drand makes honest bidders' ciphertexts decryptable;
4. observe the competing bids; and
5. reveal the retained envelope only when doing so is favorable.

Because other parties cannot recover the committed envelope from malformed or
unrelated ciphertext, permissionless reveal does not eliminate this bidder's
choice. If non-reveal is refunded, this may create a free option and violate the
intended fairness model.

This is a **security hypothesis for expert review**, not a claimed confirmed
vulnerability.

### Exact question

> At commit time we store a commitment and a ciphertext, but the contract does
> not prove that the ciphertext encrypts the committed envelope. Could a bidder
> submit malformed or unrelated ciphertext, observe other reveals after Drand,
> and reveal the known envelope only when favorable? Since unrevealed bids are
> skipped and refunded, does this create a meaningful free option?

### Mitigation trade-off to discuss

Do not assume that requiring every commitment to reveal is automatically safe.
That rule could let one malicious participant prevent clearing indefinitely or
force the entire round to void. Ask RV to compare:

- a non-reveal bond or penalty;
- voiding rounds with incomplete reveal sets;
- allowlisted/trusted participation;
- a change to the auction/economic rules;
- cryptographic proof that ciphertext and commitment contain the same message;
- another Soroban-appropriate construction.

## Open question: commitment context and replay protection

The canonical envelope currently contains:

- magic/version and flags;
- optional amount;
- nonce; and
- application-defined payload bytes.

The generic envelope does not inherently contain the network passphrase,
contract ID, round ID, bidder address, `schema_ref`, or `item_ref`. Individual
application payloads may include some context, but the core format does not
enforce it. Documentation that says the envelope includes the schema identifier
should be reconciled with the actual encoding.

Exact question:

> Which context fields should the commitment cryptographically bind to prevent
> cross-round, cross-contract, cross-network, or cross-participant replay and
> context confusion? Should the core envelope bind network, contract ID, round
> ID, bidder, schemaRef, and itemRef rather than delegating this to templates?

## Open question: bounded loops and Soroban resources

Legacy v1 has a `MAX_BIDDERS` constant of 500. The active Core v2/v3 creation
path separately enforces a maximum of **25 participants**. Do not describe the
active protocol as supporting 500-participant rounds.

`clear_v2`, `settle_v2`, and refund paths iterate over the participant set.
Auction settlement can perform a state update and token transfer for each
participant, followed by the lot transfer. Atomic settlement is valuable, so
chunking is not automatically safer: it introduces intermediate states and
additional invariants.

Exact question:

> At the 25-participant cap, with worst-case entry sizes and token transfers,
> what resource benchmark should be a release gate on the current Stellar
> network? Is one atomic settlement comfortably safe, or should we use a
> pull-based claim/refund model while preserving conservation and liveness?

Desired evidence:

- maximum-cohort simulation/preflight results;
- CPU, memory, footprint, read/write, transaction-size, and fee measurements;
- execution against the intended SAC assets;
- margin relative to current network limits, not merely a successful small
  testnet round.

## Open question: storage and TTL

Storage classes:

- Round configuration, participant state, escrow accounting, reveal results,
  and settlement flags use `Persistent` storage.
- Ciphertext and auditor blobs use `Temporary` storage and are permanently lost
  after expiry.
- After a successful reveal, the complete canonical plaintext envelope is
  persisted, so settlement does not depend on ciphertext remaining available.

The seal TTL is derived from the Unix reveal deadline using an assumed
five-second ledger close time, with a post-reveal buffer. Round duration is
capped at 30 days. Persistent state is restorable after archival; Temporary
seal data is not.

Exact question:

> How should we prove that every committed ciphertext remains available through
> the full reveal window when timestamps are converted to ledger TTL using an
> assumed five-second close time? Should we use a larger safety factor, store an
> absolute ledger boundary, or use a different storage policy?

Also ask whether restoration of all persistent entries required for a delayed
settlement should be an explicit operational runbook and test case.

## Protocol v3 reveal-policy summary

Protocol v3 adds an immutable opening policy while keeping the v2 lifecycle
methods.

### Timed

- Before the configured Drand time: opening is rejected.
- At or after Drand publication: anyone may submit the valid BLS signature and
  open reveal.
- Opening after `reveal_deadline` is rejected.

### OwnerTriggered

- Before Drand: nobody, including the operator, can open.
- After Drand but before `fallback_at`: opening requires the immutable
  operator's authorization as well as the valid Drand signature.
- At or after `fallback_at`: anyone may open with the valid Drand signature.
- `fallback_at` must be after the Drand boundary.
- At least 300 seconds must remain between fallback and `reveal_deadline`.
- If nobody opens, `void_v2` becomes permissionless strictly after
  `reveal_deadline + 3600`, returning Auction escrow and the lot.

Important limitation: OwnerTriggered does not extend cryptographic
confidentiality. Drand publication makes valid ciphertext decryptable off-chain.
The operator can inspect outcomes and delay on-chain opening until fallback.
This discretion is bounded but intentionally not eliminated.

Exact question:

> Is OwnerTriggered appropriate for value-moving Auction rounds when the
> operator can decrypt after Drand but gate on-chain opening until fallback?
> Should this policy be limited to ReceiptOnly, or is the bounded fallback an
> acceptable and clearly disclosed trade-off?

## Candidate invariants for fuzzing or formal specification

Ask RV to correct, remove, or add to this list:

1. Payment-token conservation: total bidder escrow equals seller payment plus
   all bidder refunds plus any contract balance still legitimately locked.
2. Lot-token conservation: the lot is held by the contract while active and is
   transferred exactly once to the winner or returned exactly once to the
   operator on void/no-valid-bid paths.
3. No participant can be paid or refunded more than their recorded entitlement.
4. No terminal Auction state leaves payment escrow or the lot stranded in the
   Round contract.
5. Only a valid Drand round-R signature can open reveal.
6. No valid reveal is accepted before the configured privacy boundary.
7. A revealed envelope must match the committed envelope hash exactly.
8. Clearing is deterministic for a fixed ordered participant/reveal set,
   including tie behavior.
9. Winner and winning amount cannot change after clearing.
10. Every permitted lifecycle state has either a permissionless path to a safe
    terminal state or an explicitly documented failure assumption.
11. ReceiptOnly never transfers or escrows assets.
12. Protocol-v3 policy state fails closed if missing and cannot silently fall
    back to a less restrictive policy.

Questions for RV:

> Which of these properties should be fuzzed, and which are worth formally
> specifying? Are there Soroban-specific properties around authorization,
> storage restoration, cross-contract token calls, or transaction resources
> that are missing?

## Short answers to likely questions

### What problem does Sub Rosa solve?

It provides reusable sealed submissions on Stellar: proposals or bids remain
encrypted until a public Drand boundary, then become independently revealable
and verifiable. Auction mode also supplies a narrow, deterministic custody and
settlement path.

### Why use Drand?

Drand gives the protocol a public future decryption boundary that the round
operator does not generate. The Soroban contract verifies the relevant Drand
BLS signature before moving into the reveal phase.

### Why verify Drand on-chain if decryption is off-chain?

The contract needs an independently verifiable gate before it accepts reveal
progression. Decryption stays off-chain because the tlock payload is opened by
keepers or observers and the contract validates the resulting commitment-bound
envelope.

### Who can reveal a bid?

Anyone can call `reveal_v2` with the bidder address and correct plaintext
envelope after the round is open. The original bidder's authorization is not
required, which is intentional for liveness.

### What if the keeper fails?

The keeper has no exclusive authority; another observer can perform the same
open/reveal/clear/settle calls. Liveness still depends on at least one caller,
RPC availability, adequate fees, correct ciphertext, and enough time before the
deadline.

### What if Drand never publishes the signature?

The round remains unopened. After the reveal deadline and one-hour grace,
`void_v2` is permissionless for an Open round and refunds Auction escrow and
returns the lot.

### What assets are at risk?

Only Auction mode holds bidder payment escrow and the seller's lot. ReceiptOnly
rejects escrow and asset configuration and performs no token transfers.

### Does the operator control the outcome?

The operator configures the round, assets, policy, deadlines, participant
eligibility, and clearing rule. It cannot replace the deterministic clear
result. Under v3 OwnerTriggered, it does have bounded discretion to delay
on-chain opening between Drand publication and fallback.

### Why use fixed escrow?

All Auction participants lock the same public amount, so escrow size does not
reveal the private bid. The revealed amount must be positive and no greater
than the participant's escrow.

### What happens to an unrevealed Auction bid?

It is excluded from winner selection. During settlement after another valid
winner is found, its escrow is refunded. This behavior is central to the
selective-reveal/free-option question being brought to RV.

### Are token transfers atomic?

The current Auction path pays the seller, refunds participants, transfers the
lot, updates settlement state, and reaches the terminal status in one Soroban
transaction. The discussion point is whether the worst-case 25-participant path
has sufficient resource margin.

### Is the code audited?

No. It has contract tests and live capped evidence, but no independent
funds-handling audit is claimed. Independent review is required before uncapped
mainnet use or promotion of protocol v3.

### Is it production-ready?

Not for uncapped value. Current documentation explicitly requires capped use,
deployment pinning, monitoring, and an independent funds-handling review before
uncapped production usage.

### What is the most important thing wanted from this session?

A prioritized expert assessment of the ciphertext/commitment and non-reveal
model, followed by concrete audit-readiness requirements for context binding,
resource limits, storage, fuzzing, and formal properties.

### What is the difference between v2 and v3?

The core structured submission, clearing, and settlement lifecycle remains the
v2 API. Protocol v3 adds an immutable Timed or OwnerTriggered opening policy,
an explicit Drand-time check, a permissionless fallback, and recorded opening
metadata. V3 is currently a separate testnet deployment.

### Why are reveals separate transactions?

It avoids a single unbounded reveal-all operation and prevents one malformed
submission from causing all valid submissions to fail in the same transaction.
The trade-off is that the reveal set is not atomic and must be monitored until
the deadline.

### What security tooling is currently used?

The project has deterministic Rust contract tests, snapshot/error-surface
checks, TypeScript SDK/keeper tests, real Drand vectors, preflight support, and
live testnet lifecycle evidence. It does not yet have a claimed formal model or
dedicated fuzzing campaign; selecting those is an objective of this session.

## Safe answers when uncertain

Never improvise a security guarantee. Use one of these responses:

> I don't have a confident answer to that yet. That is exactly the kind of
> assumption I want to capture as an action item.

> I can show you the current behavior in the contract, but I do not want to
> claim that it is the correct security policy without reviewing the trade-off.

> The tests cover the expected path, but we have not established that property
> formally or through a dedicated fuzzing campaign.

> I need to verify whether that statement applies to mainnet Core v2, testnet
> protocol v3, or both before answering.

> That is currently an operational assumption rather than an on-chain
> guarantee.

> I would prefer to record that as an open question instead of guessing. What
> evidence would you expect us to produce?

## Claims to avoid

Do not say:

- "Sub Rosa is audited."
- "The protocol is production-ready."
- "Permissionless reveal guarantees that every bid will be revealed."
- "The operator has no discretion" without distinguishing Timed from
  OwnerTriggered v3.
- "The active protocol supports 500 bidders." Core v2/v3 is capped at 25.
- "Tests prove security."
- "The deployed mainnet contract is v3."
- "The envelope already binds every round and deployment context."

Prefer:

- "This behavior is tested, but not independently audited."
- "This is the intended invariant; we want your help validating it."
- "The current design accepts this as a residual risk."
- "Mainnet is Core v2; v3 is currently a separate testnet candidate."

## Recommended session order

If the session is 30 minutes:

1. 0–3 minutes: protocol and exact artifact scope.
2. 3–15 minutes: ciphertext/commitment and selective-reveal hypothesis.
3. 15–22 minutes: domain/context binding.
4. 22–27 minutes: 25-participant resources and TTL.
5. 27–30 minutes: top-three audit blockers and next actions.

If the session is 60 minutes, add deeper discussion of OwnerTriggered policy,
formal invariants, fuzzing strategy, deployment provenance, and recommended
Stellar security tooling.

## Closing questions

End with:

> If this exact v3 artifact entered a formal audit tomorrow, what are the top
> three things you would ask us to change or prepare first?

> Which properties would you fuzz, and which are worth formally specifying?

> What concrete evidence would make you comfortable that the 25-participant
> settlement and refund paths have enough resource margin?

> Is this architecture ready to apply for a full Audit Bank review, or is there
> another security milestone you would recommend first?

Confirm the answer before leaving:

> My understanding is that the priority order is: first X, then Y, then Z. Did I
> capture that correctly?

