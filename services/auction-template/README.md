# Core v2 Auction Template

This template runs a complete Sub Rosa `Auction` lifecycle on Stellar testnet:

```text
create -> 3 sealed commits -> Drand reveal -> clear -> atomic settle + refunds
```

It uses the public `@sub-rosa/sdk` surface and the canonical Core v2 testnet
deployment. The script uses native testnet XLM for bidder escrow, creates a
classic test asset for the auction lot, deploys its deterministic Stellar Asset
Contract, and exports a verified public evidence record after settlement.

## Prerequisites

- Node.js 22 or newer
- pnpm 10
- Stellar CLI 23 or newer
- one funded testnet issuer identity
- one funded testnet seller identity
- three funded testnet bidder identities

The seller and bidders must be distinct funded Stellar testnet accounts. Each
bidder escrows 25 testnet XLM per round. This template is for testnet evidence
only and must not be used for uncapped value.

## Install

From the repository root:

```bash
pnpm install
pnpm packages:build
```

## Run one round

Expose the five testnet signing keys only to the local process:

```bash
export ISSUER_SECRET="$(stellar keys show testnet-issuer)"
export SELLER_SECRET="$(stellar keys show testnet-seller)"
export BIDDER1_SECRET="$(stellar keys show testnet-bidder-1)"
export BIDDER2_SECRET="$(stellar keys show testnet-bidder-2)"
export BIDDER3_SECRET="$(stellar keys show testnet-bidder-3)"

INSTA_ROUND_COUNT=1 pnpm template:v2:testnet
```

The script writes a `PublishedAuctionEvidence` JSON file under
`apps/web/public/instawards/receipts/`. It contains:

- the canonical Core v2 receipt;
- round, contract, Drand, bidder, escrow, winner, and settlement fields;
- native testnet XLM as the canonical payment and escrow asset;
- every Sub Rosa lifecycle transaction hash;
- one atomic `settle_and_refund` hash covering seller payment, lot transfer,
  winner surplus, and losing bidder refunds.

No secret keys are written to the evidence file.

## Reproduce the Instawards evidence set

```bash
INSTA_ROUND_COUNT=3 pnpm template:v2:testnet
```

This produces three independent Auction rounds with three bidders each. The
public web route for an exported record is:

```text
#/receipt/instawards-auction-1
```

Use `instawards-auction-2` and `instawards-auction-3` for the other rounds.

## Verify locally

```bash
pnpm --filter @sub-rosa/sdk test
pnpm --filter @sub-rosa/auction-template test
pnpm web:build
```

The offline template remains available with `pnpm template:fixture`; it is test
coverage and does not count as live network evidence.
