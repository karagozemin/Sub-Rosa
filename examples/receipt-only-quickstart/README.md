# Stellar Testnet ReceiptOnly quickstart

This runnable example creates a real zero-escrow `ReceiptOnly` round on the
canonical Sub Rosa Core v2 testnet contract, seals and submits one structured
proposal, waits for Drand, reveals and clears the round, then exports and
verifies its canonical receipt.

It uses one disposable testnet account as organizer, participant, and lifecycle
caller to keep the first integration small. Production systems should separate
those operational roles where their trust or fee model requires it.

## Prerequisites

- Node.js 22 or newer
- pnpm 10.13.1 through Corepack
- Internet access to Stellar Testnet RPC, Friendbot, and Drand quicknet
- A disposable, funded Stellar Testnet account; never use a mainnet secret here

## Install and validate offline

From the repository root:

```bash
corepack enable
pnpm install
cp examples/receipt-only-quickstart/.env.example examples/receipt-only-quickstart/.env
pnpm quickstart:keypair
pnpm quickstart:check
```

Copy the generated `STELLAR_SECRET_KEY` into the example's `.env`. Open the
printed Friendbot URL once to create and fund the matching public account.

The `quickstart:check` command type-checks the complete live runner and tests its
deadline, configuration, and explorer helpers without contacting Stellar or
waiting for a Drand round.

## Optional live Testnet run

```bash
pnpm quickstart:live
```

The run normally takes a few minutes because it deliberately waits for both the
Drand reveal boundary and the on-chain reveal deadline. It pays Stellar Testnet
fees from `STELLAR_SECRET_KEY`; `ReceiptOnly` moves no escrow or lot asset.

Successful output ends with `RECEIPT_ONLY_QUICKSTART_PASSED`, a verified round
ID, canonical contract ID, and the real transaction hashes plus Stellar Expert
Testnet URLs. The example never embeds or fabricates transaction hashes.

## Environment

| Variable | Required | Meaning |
|---|---:|---|
| `STELLAR_SECRET_KEY` | yes | Disposable funded Testnet `S...` signer; keep it server-side |
| `ROUND_CONTRACT_ID` | no | Reviewed Core v2 Testnet override; the named preset is the default |

## Common failures

- **Missing/funded account:** fund the public `G...` address with the printed
  Friendbot URL, then retry.
- **`CommitClosed` (10):** the two create/commit transactions missed the commit
  window; rerun to create a fresh round.
- **Drand 425/not published:** wait for the printed boundary. Do not substitute
  a different signature.
- **`RevealStillOpen` (16):** Stellar ledger time has not crossed the deadline;
  the example retries preflight automatically.
- **Network/contract mismatch:** remove an unreviewed `ROUND_CONTRACT_ID` or pin
  the matching RPC, passphrase, contract, and WASM hash together.
- **RPC timeout:** keep the recorded transaction hashes and query them before
  retrying a write; do not assume a timed-out submission failed.

`verifyReceiptV2` checks receipt consistency offline. For evidentiary use, also
inspect the emitted transaction URLs and independently re-export the receipt
from the pinned Stellar network and contract.
