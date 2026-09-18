# `@sub-rosa/sdk`

Public TypeScript client for Sub Rosa sealed auctions and receipt-only proposal
rounds on Stellar.

## Install

```bash
npm install @sub-rosa/sdk
```

The package ships compiled ESM and TypeScript declarations. Node.js 22 or newer
is supported. Browser applications should provide the wallet/signing adapter
used by their Stellar stack.

## Network configuration

Use a named network preset for the canonical deployment:

```ts
import { SubRosaClient } from "@sub-rosa/sdk";

const client = new SubRosaClient({
  network: "testnet",
  publicKey: process.env.STELLAR_PUBLIC_KEY,
});
```

`network: "mainnet"` selects the official Core v2 deployment on the Stellar
public network. An explicit `contractId` is still accepted for a caller-owned
reviewed deployment:

```ts
const client = new SubRosaClient({
  network: "mainnet",
  secretKey: process.env.STELLAR_SECRET_KEY,
});
```

Browser integrations pass their wallet source and Freighter-compatible signing
callbacks instead of a secret key:

```ts
const client = new SubRosaClient({
  network: "mainnet",
  publicKey: walletAddress,
  signTransaction: wallet.signTransaction,
  signAuthEntry: wallet.signAuthEntry,
});
```

The legacy v1 mainnet proof is never selected as a Core v2 default. Custom RPCs
remain supported with `rpcUrl`; custom networks can continue to provide the
full `rpcUrl`, `networkPassphrase`, and `contractId` tuple.

On the first contract call, the client asks the RPC for its actual network
passphrase and confirms that `contractId` exists on that network. The result is
cached for later calls. A mismatch throws `SubRosaNetworkMismatchError` before
simulation, signing, or submission, with the conflicting values and a suggested
fix. Contract IDs do not encode a Stellar network, so copying a `C...` address
between Testnet and Mainnet requires updating all three configuration values.

## Fees and signing

The SDK does not charge fees to Sub Rosa. Each state-changing call is paid by
the transaction source that signs it: the seller pays create/settle calls, each
bidder pays its submission, and a keeper pays lifecycle calls it submits.
Escrow and lot assets are contract value, separate from Stellar network fees.
An optional relayer may sponsor fees, in which case the relayer operator pays.
Read-only simulation and receipt verification do not submit transactions.

Successful writes are available as `client.submittedTransactionHashes`, which
lets integrations preserve explorer evidence without parsing logs.

## Core v2 partner templates

Core v2 keeps one sealed-round lifecycle and exposes two reviewed templates.
`ReceiptOnly` is suitable for a design-partner proposal pilot and never moves
assets. `Auction` requires payment and lot SAC addresses, takes the lot into
custody when the round is created, and exchanges payment for the lot atomically
at settlement.

Both helpers create contract-enforced partner rounds. Pass
`eligibleParticipants` to restrict commits to a known cohort, or omit it for an
open round. Auction rounds require `fixedEscrow`; every bidder must lock exactly
that amount.

```ts
import {
  createSealedProposalRound,
  generateAuditorKeypair,
  quicknet,
  roundInSeconds,
  sealProposal,
} from "@sub-rosa/sdk";

const drand = quicknet();
const revealRound = await roundInSeconds(drand, 5 * 60);
const auditor = generateAuditorKeypair();

const roundId = await createSealedProposalRound(client, {
  itemRef,
  revealRound,
  commitDeadline,
  revealDeadline,
  auditorPubkey: auditor.publicKey,
  eligibleParticipants: [providerA, providerB], // optional
});

const sealed = await sealProposal({
  round: Number(revealRound),
  drand,
  price: 2_500n,
  proposal: {
    timelineDays: 14,
    approach: "manual and automated Soroban review",
  },
});

await client.submitV2({ roundId, sealed, escrow: 0n });
```

An asset auction uses the same reveal and keeper infrastructure, but makes
custody explicit at creation:

```ts
import { createAssetAuctionRound, sealAssetBid } from "@sub-rosa/sdk";

const roundId = await createAssetAuctionRound(client, {
  itemRef,
  paymentAsset: usdcSac,
  lotAsset: collectibleSac,
  lotAmount: 1n,
  fixedEscrow: 1_000n,
  revealRound,
  commitDeadline,
  revealDeadline,
  auditorPubkey,
});

const sealed = await sealAssetBid({
  round: Number(revealRound),
  drand,
  amount: 700n,
});

await client.submitV2({ roundId, sealed, escrow: 1_000n }); // exact fixed escrow
```

The creating wallet must hold and authorize transfer of `lotAmount`. Bidders
must hold and authorize the round's fixed escrow. The SDK preflight methods can
simulate every state-changing call before signing.

## Owner-triggered reveal (protocol 3, opt-in)

Core v2 uses a **Timed** reveal: once Drand publishes round R, anyone can open
reveal. Protocol 3 adds an alternative **owner-triggered** policy — also called
*manual reveal* — where, after R, only the round's immutable operator may open
until a `fallbackAt` timestamp. At or after `fallbackAt` anyone may open, so a
silent operator can never freeze escrow or the lot.

Protocol 3 is a **separate, non-default deployment**. The named-network defaults
(`network: "testnet" | "mainnet"`) and `resolveSubRosaDeployment` still resolve
to the reviewed Core v2 contracts. You reach protocol 3 only by using its own
contract id, exposed through `resolveRevealPolicyV3Deployment`:

```ts
import {
  resolveRevealPolicyV3Deployment,
  SubRosaClient,
} from "@sub-rosa/sdk";

const v3 = resolveRevealPolicyV3Deployment("testnet");
const operator = new SubRosaClient({
  rpcUrl: v3.rpcUrl,
  networkPassphrase: v3.networkPassphrase,
  contractId: v3.contractId,
  secretKey: process.env.OPERATOR_SECRET_KEY,
});

// A Core v2 contract has no reveal policy — probe capability 3 first.
if (!(await operator.supportsRevealPolicy())) {
  throw new Error("Target contract is Core v2 (Timed reveal only).");
}

// fallbackAt must be AFTER Drand R, and revealDeadline must be at least
// fallbackAt + 300s. Otherwise create_round_v3 reverts with error 46
// (InvalidRevealPolicy); the SDK also rejects it client-side first.
const roundId = await operator.createRoundV3({
  ...auctionParams, // same item / schema / mode / deadline fields as Core v2
  revealPolicy: { type: "owner-triggered", fallbackAt: privacyAt + 300 },
  revealDeadline: privacyAt + 900,
});
```

Commit and submit are unchanged (`submitV2`). Reveal differs only in *who* can
open, then follows the identical Core v2 flow:

```ts
import { fetchRoundSignature, quicknet } from "@sub-rosa/sdk";

// The policy is immutable and readable at any time. A plain Core v2 round has
// none, so getRevealStateV3 throws error 47 (RevealPolicyMissing).
const state = await operator.getRevealStateV3(roundId);
// state.policy   -> { tag: "OwnerTriggered", values: [fallbackAt] }
// state.opened_at -> undefined until reveal opens, then the open time

const signature = await fetchRoundSignature(quicknet(), Number(revealRound));

// MANUAL REVEAL — before fallbackAt only the immutable operator may open.
// A non-operator calling openRevealV2 early fails require_auth (a host
// authorization error, not a numbered contract code).
await operator.openRevealV2(roundId, signature);

// PERMISSIONLESS FALLBACK — if the operator stays silent, any funded account
// may open at or after fallbackAt:
//   await anyone.openRevealV2(roundId, signature);

// Identical to Core v2 from here:
await bidder.revealV2({ roundId, bidder: bidderAddress, envelope });
const winner = await operator.clearV2(roundId);
if (winner) await operator.settleV2(roundId); // Auction mode only

// Recovery: past revealDeadline + 3600s anyone may voidV2 to refund all escrow.
```

The two numbered protocol-3 error codes are `46 InvalidRevealPolicy` (create
with a `fallbackAt` that is not after Drand R, or leaves under 300s before the
reveal deadline) and `47 RevealPolicyMissing` (reading or opening protocol-3
state on a round that has none). The operator-only restriction before
`fallbackAt` is enforced by `require_auth`, so it surfaces as an authorization
failure rather than a numbered code.

Opening reveal does **not** add confidentiality: once Drand publishes R, anyone
holding a ciphertext can decrypt off-chain, including the operator. The fallback
only bounds how long the operator can delay *on-chain* opening. Use the default
Timed policy when operator discretion is undesirable.

Rollout status: the protocol 3 testnet contract is
`CB7VIYY4RQLZG2Y6HLDWB3UKSVOAIDYFZ5TGW5AUBCIPJHTCZV4ZWQFF` (WASM SHA-256
`7a72a82c…b150b194`, exported as `REVEAL_POLICY_V3_WASM_HASH`). Mainnet is
**pending an independent funds-handling review**; until then
`resolveRevealPolicyV3Deployment("mainnet")` has no configured contract and
requires a caller-owned `contractId`.

## Low-level packages

`@sub-rosa/sdk` exposes the complete partner integration surface and installs
compatible `@sub-rosa/tlock` and `@sub-rosa/round-bindings` versions
automatically. Install either package directly only when building custom
cryptography, indexing, or contract tooling.

## Security boundary

The SDK validates configuration and canonical payloads, but it cannot make an
unknown contract deployment trustworthy. Production applications should pin a
reviewed network, contract ID, and WASM hash. Core v2 has testnet proofs and an
official capped-mainnet deployment. It requires independent funds-handling
review before uncapped mainnet use.
