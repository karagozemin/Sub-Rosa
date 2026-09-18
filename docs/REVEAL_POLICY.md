# Reveal policy release (protocol 3)

Status: implemented and deployed to a **separate testnet contract** with live
value-moving proofs recorded (2026-09-18); mainnet deployment and independent
funds-handling review remain separate, pending tasks. The canonical SDK/UI
deployment defaults and reviewed Core v2 WASM hash remain unchanged: those
default contracts do not support owner-triggered opening or the corrected
on-chain Drand time check, and the v3 testnet contract is reached only via an
explicit contract ID. Updating the SDK alone does not update a deployed contract.

Testnet v3 contract: `CB7VIYY4RQLZG2Y6HLDWB3UKSVOAIDYFZ5TGW5AUBCIPJHTCZV4ZWQFF`
(WASM `7a72a82c…b194`, capability 3). Evidence:
`artifacts/reveal-policy-v3/testnet/deployment.json` and `lifecycle.json`.

## Timing and authorization

Drand round R is scheduled at `genesis + period * (R - 1)`. The commit deadline
must be strictly earlier. The 30-day maximum round duration remains enforced.
Only correctly sealed payloads receive the timelock privacy guarantee.

| Policy | Before Drand | After Drand, before fallback | At/after fallback |
| --- | --- | --- | --- |
| Timed | Cannot open | Anyone can open | Anyone can open |
| Owner-triggered | Cannot open, including owner | Only the immutable operator can authorize opening | Anyone can open |

Owner-triggered rounds require `fallbackAt > Drand time` and
`revealDeadline >= fallbackAt + 300`. This applies to both Auction and
ReceiptOnly. The controller is the round operator; there is no separate mutable
controller, deadline setter, or policy setter. Opening verifies the real Drand
BLS signature under both policies. At the exact fallback timestamp no owner
authorization is required. New rounds reject opening after the reveal deadline.

Once open, reveal, clear and settle remain permissionless. Each submission is a
separate transaction. At the latest intended opening time (fallback), at least
five minutes remain to submit reveals; outages or a keeper starting later can
still shorten the usable window. Use a larger window for slow operators or RPCs.
If nobody opens, `void_v2` remains permissionless after `revealDeadline + 3600`
(strictly greater), returning escrow and the auction lot. ReceiptOnly clear
finalizes without token settlement.

**Owner opening does not extend confidentiality.** When Drand publishes the
signature, anyone with a ciphertext can decrypt it off-chain, including the
operator. An operator can inspect outcomes and delay opening until fallback.
The fallback bounds that delay; it does not remove this discretion. Use Timed
when this discretion is undesirable. Drand publication is not an automatic
on-chain transaction.

## API and compatibility

Existing `create_round`, `create_round_v2`, and `create_partner_round_v2` keep
their signatures and timed opening. New `create_round_v3` receives
`RoundPolicyV3 { partner, reveal }` in place of the old partner policy, retaining
the ten-argument ABI limit. It writes `protocol_version = 3` in the existing
structured round layout and a required separate `RevealStateV3` record. The
state contains an immutable policy and the successful opening timestamp.

`get_round_v2`, `commit_v2`, `open_reveal_v2`, `reveal_v2`, `clear_v2`, `settle_v2`
and `void_v2` handle both structured record versions. `protocol_version()`
advertises capability 3. `get_reveal_state_v3` reads the new policy. Missing or
archived reveal state fails closed; restore it before opening rather than
assuming Timed. Voiding remains available if state cannot be restored in time.

The new SDK exposes `createRoundV3`, `preflightCreateRoundV3`,
`supportsRevealPolicy` and `getRevealStateV3`. For example:

```ts
const privacyAt = drandRoundTime(revealRound, await drand.chain().info());
const roundId = await sdk.createRoundV3({
  ...proposalParams, // item/schema refs, mode, deadlines, auditor key, etc.
  fixedEscrow: 0n,   // ReceiptOnly; Auction requires a positive fixed escrow
  revealPolicy: { type: "owner-triggered", fallbackAt: privacyAt + 300 },
  revealDeadline: privacyAt + 900,
});
// sdk.openRevealV2(roundId, signature) uses the owner's signer before fallback.
```

Keep `KEEPER_PROTOCOL_VERSION=2` for the structured lifecycle API, including v3
records. The keeper waits for fallback, or continues reveals if the owner has
already opened. Its dry-run/status reports the owner wait and late-open grace.
The generic `#/pilot` workspace provides the creation selector, owner opening,
fallback timing and stale-round refund action. Partner-specific pilot creators
retain their existing timed flows. Capability probing disables owner-triggered
creation on existing deployments.

`exportReceiptV2` exports legacy records as receipt version 2 and new records as
version 3, including `revealPolicy`, `controller`, `fallbackAt` and `openedAt`
as applicable. `verifyReceiptV2` accepts both, checks v3 timing/policy consistency
and rejects stripped or contradictory policy data. Old verifiers reject v3
rather than accepting it as timed. Offline receipts still do not prove that
exported metadata matches a ledger or that owner authorization was signed;
cross-check contract state and transaction evidence for those claims.

The receipt CLI defaults to the structured API for export; set
`RECEIPT_PROTOCOL_VERSION=1` for legacy rounds. Verification detects versions
1/2/3. Structured receipt redaction is rejected because changing committed
payload bytes destroys verification evidence.

## Deployment and rollback plan

1. Run `pnpm protocol:prepare`. It builds packages/WASM, checks generated
   bindings and emits a content-addressed WASM plus `release.json` under
   `artifacts/reveal-policy-v3/`. It sends no transactions. Review the dirty-tree
   flag and pin the exact artifact/hash after committing the approved source.
2. Run the contract tests, workspace type checks, coverage gate, web tests/build,
   error drift, snapshot and documentation checks. Record toolchain versions,
   artifact hash, and results with the release.
3. Deploy this artifact to a **new testnet contract** with the existing validated
   Quicknet constructor parameters (see `services/drand-tools` and the existing
   deployment helpers). There is no contract upgrade entry point. Record the
   new ID, constructor config, hash and transaction hash separately; do not
   overwrite historical deployment evidence.
4. Verify the on-chain WASM hash and capability 3, then run funded, capped testnet
   scenarios: Timed legacy compatibility; owner opening; outsider rejection;
   automatic fallback; Auction escrow/lot conservation; ReceiptOnly finalization;
   missed opening and refunds; receipt export/verification. Record actual fees
   and resource usage. Local tests are not evidence of these network runs.
5. Configure a separate keeper/UI with explicit `CONTRACT_ID`/`VITE_CONTRACT_ID`
   for testnet acceptance. Existing defaults continue serving old rounds. Keep
   an old keeper deployment running until its active rounds are terminal.
6. Mainnet requires a separate reviewed rollout, capped funding and explicit
   deployment execution. Re-simulate upload/deploy fees for the new WASM. The old
   `mainnet:v2:prepare`/deploy scripts intentionally pin the historical v2 hash
   and must not be bypassed or relabeled as v3 approval.
7. Promote deployment registry/package/UI defaults only after recording the new
   deployment evidence. Rollback means routing **new** rounds back to the old
   contract and retaining keepers for already-created v3 rounds until settled or
   voided. A round cannot migrate between contract IDs.

| External step | Status |
| --- | --- |
| New testnet deployment and live owner/fallback proofs | Done 2026-09-18 (`CB7VIYY4…ZWQFF`; evidence under `artifacts/reveal-policy-v3/testnet/`) |
| Independent funds-handling review | Pending; reviewer not engaged by this change |
| New mainnet deployment and default promotion | Pending |
