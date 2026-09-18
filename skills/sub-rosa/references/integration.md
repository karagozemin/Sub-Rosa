# Sub Rosa Core v2 integration

Load this reference when implementing the SDK flow. Keep secrets server-side
unless a browser wallet owns the signing step.

## Current testnet deployment

```text
RPC: https://soroban-testnet.stellar.org
Network passphrase: Test SDF Network ; September 2015
Core v2 contract: CCOVGOQQZJKZ2R55GRWBLTJTGBAMSHXZVN3ICPG3WRVMLMM6RHISC5OV
WASM SHA-256: 2c7bc6b4c91940ac185df38a3d0a8532b555140d818df94f03f894e5952ebf42
Drand: quicknet / bls-unchained-g1-rfc9380
```

Treat these as one deployment tuple. Reconfirm them against the project's
current documentation before a new pilot.

## Current mainnet deployment

```text
RPC: https://mainnet.sorobanrpc.com
Network passphrase: Public Global Stellar Network ; September 2015
Core v2 contract: CDQOFNCJE5Z4ZZL76DU5652FOUKJVEIZWHFGCZVWH63UYBGPSZIPC325
WASM SHA-256: 2c7bc6b4c91940ac185df38a3d0a8532b555140d818df94f03f894e5952ebf42
Drand: quicknet / bls-unchained-g1-rfc9380
```

Use `network: "mainnet"` for this canonical tuple. Keep participant and value
caps until independent funds-handling review is complete.

## Configure a client

```ts
import { SubRosaClient } from "@sub-rosa/sdk";

const client = new SubRosaClient({
  rpcUrl: "https://soroban-testnet.stellar.org",
  networkPassphrase: "Test SDF Network ; September 2015",
  contractId: process.env.SUB_ROSA_CONTRACT_ID!,
  secretKey: process.env.STELLAR_SECRET,
});
```

Omit `secretKey` for read-only clients. Browser applications may provide the
generated `RoundContract` with wallet-backed `signTransaction` and
`signAuthEntry` callbacks instead of exposing a secret.

## Create an asset auction

```ts
import {
  createAssetAuctionRound,
  generateAuditorKeypair,
  quicknet,
  roundInSeconds,
  sealAssetBid,
} from "@sub-rosa/sdk";

const drand = quicknet();
const chain = await drand.chain().info();
const revealRound = await roundInSeconds(drand, 300);
const revealAt = Number(chain.genesis_time) + Number(chain.period) * (revealRound - 1);
const auditor = generateAuditorKeypair();

const roundId = await createAssetAuctionRound(sellerClient, {
  itemRef,                         // 32-byte stable item reference
  paymentAsset: usdcSac,
  lotAsset: collectibleSac,
  lotAmount: 1n,
  fixedEscrow: 1_000_000_000n,
  revealRound,
  commitDeadline: revealAt - 15,
  revealDeadline: revealAt + 300,
  auditorPubkey: auditor.publicKey,
  maxParticipants: 10,
  eligibleParticipants: collectors, // omit for an open round
});

const sealed = await sealAssetBid({
  round: Number(revealRound),
  drand,
  amount: 700_000_000n,
  payload: new TextEncoder().encode(JSON.stringify({ termsVersion: 1 })),
});

await bidderClient.submitV2({
  roundId,
  sealed,
  escrow: 1_000_000_000n,
});
```

The seller authorizes lot custody at creation. Every bidder locks the same
`fixedEscrow`; the private bid must be less than or equal to it. Settlement
atomically transfers the winning amount and lot, refunds the winner's surplus,
and refunds losing bidders.

## Create a sealed proposal round

```ts
import { createSealedProposalRound, sealProposal } from "@sub-rosa/sdk";

const roundId = await createSealedProposalRound(organizerClient, {
  itemRef,
  revealRound,
  commitDeadline,
  revealDeadline,
  auditorPubkey: auditor.publicKey,
  maxParticipants: 12,
  eligibleParticipants: providers,
});

const sealed = await sealProposal({
  round: Number(revealRound),
  drand,
  price: 25_000_000_000n,
  proposal: {
    timelineDays: 14,
    approach: "Manual review, fuzzing, and remediation report",
    metadata: { teamSize: "3", region: "EU" },
  },
});

await providerClient.submitV2({ roundId, sealed, escrow: 0n });
```

The organizer compares revealed proposals and chooses off-chain. Do not imply
that `LowestBid` makes the business decision; ReceiptOnly produces a canonical
submission/reveal receipt and moves no assets.

## Advance the lifecycle

```ts
import { fetchRoundSignature, openPayload } from "@sub-rosa/sdk";

const round = await keeperClient.getRoundV2(roundId);
const signature = await fetchRoundSignature(drand, Number(round.reveal_round));
await keeperClient.openRevealV2(roundId, signature);

for (const bidder of await keeperClient.getBiddersV2(roundId)) {
  const state = await keeperClient.getSubmissionV2(roundId, bidder);
  if (state.revealed_envelope) continue;

  const seal = await keeperClient.getSealV2(roundId, bidder);
  if (!seal) continue;
  const envelope = await openPayload(seal.ciphertext, drand);
  await keeperClient.revealV2({ roundId, bidder, envelope });
}

await keeperClient.clearV2(roundId); // only after revealDeadline
const finalRound = await keeperClient.getRoundV2(roundId);
if (finalRound.status.tag === "Cleared" && finalRound.mode.tag === "Auction") {
  await keeperClient.settleV2(roundId);
}
```

Use the corresponding `preflightOpenRevealV2`, `preflightRevealV2`,
`preflightClearV2`, and `preflightSettleV2` before wallet-backed calls.

## Verify a receipt

```ts
import { serializeReceiptV2, verifyReceiptV2 } from "@sub-rosa/sdk";

const receipt = await reader.exportReceiptV2(roundId);
const result = verifyReceiptV2(receipt);
if (!result.valid) throw new Error(JSON.stringify(result.issues));

const canonicalJson = serializeReceiptV2(receipt);
```

Store `canonicalJson`, round ID, network, contract ID, and transaction hashes.
Requery the live contract when ledger provenance or receipt freshness matters.
