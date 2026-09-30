# Instawards Month 2 — Core v2 Mainnet Auction Evidence

Completed on 2026-09-30 on the Stellar public network.

## Result

**PASS — Core v2 mainnet capped auction lifecycle completed.**

Round `1` completed the full on-chain lifecycle: create, sealed commit, Drand-gated open, reveal, clear, and atomic settlement/refund. The canonical receipt was exported, verified offline, and reconciled against the live contract state.

| Field | Evidence |
| --- | --- |
| Network | Stellar Mainnet |
| Contract | [`CDQOFNCJE5Z4ZZL76DU5652FOUKJVEIZWHFGCZVWH63UYBGPSZIPC325`](https://stellar.expert/explorer/public/contract/CDQOFNCJE5Z4ZZL76DU5652FOUKJVEIZWHFGCZVWH63UYBGPSZIPC325) |
| Reviewed WASM hash | `2c7bc6b4c91940ac185df38a3d0a8532b555140d818df94f03f894e5952ebf42` |
| Round | `1` |
| Status | `Settled` |
| Drand round | `32641289` |
| Lot | `0.01 XLM` |
| Winning bid | `0.05 XLM` |
| Fixed escrow | `0.10 XLM` |
| Atomic refund | `0.05 XLM` winner surplus, in the settlement transaction |
| Canonical receipt | [`instawards-mainnet-auction-1.json`](../apps/web/public/instawards/receipts/instawards-mainnet-auction-1.json) |

## Public transaction evidence

| Phase | Ledger | Transaction |
| --- | ---: | --- |
| Create round | `64688279` | [`254930…7c89`](https://stellar.expert/explorer/public/tx/254930b075d1491b665022364adf1bb89421ee67e851a34cc3c428086a877c89) |
| Sealed commit | `64688281` | [`96b3f5…6aa`](https://stellar.expert/explorer/public/tx/96b3f535934491f137dedcad384c448532d7b596453fe3a04cf14205edd396aa) |
| Open reveal | `64688291` | [`0eefdc…6692`](https://stellar.expert/explorer/public/tx/0eefdc47a004d14ddc10203aeb077ac54e64bc9c2d615f89228d2a052c0c6692) |
| Reveal | `64688293` | [`abca88…0456`](https://stellar.expert/explorer/public/tx/abca8822111209ec500a7b7f5ed6b27380668a3909aff7ce87fcbb2957b00456) |
| Clear | `64688304` | [`0d99de…a708`](https://stellar.expert/explorer/public/tx/0d99de7a9ce14d25eccb240c0d3a6b3ee64d7f878a62e0b4d05c5c456f7aa708) |
| Atomic settle + refund | `64688305` | [`24f83b…9204`](https://stellar.expert/explorer/public/tx/24f83b09053d5d6d104166051cd84582eec7e3bfe1574621aa7a4c82e5c69204) |

All six transactions returned `SUCCESS` from the Stellar mainnet RPC. The settlement call transferred the `0.05 XLM` winning payment to the seller, refunded `0.05 XLM` of unused fixed escrow to the winner, and transferred the `0.01 XLM` lot to the winner in one transaction.

## Verification commands

```bash
ROUND_CONTRACT_ID=CDQOFNCJE5Z4ZZL76DU5652FOUKJVEIZWHFGCZVWH63UYBGPSZIPC325 \
ROUND_ID=1 pnpm mainnet:v2:verify

pnpm --filter @sub-rosa/auction-template test
```

Expected result: `CORE V2 MAINNET VERIFY PASSED`, `roundStatus: Settled`, and `receiptVerified: true`.

## Scope note

This deliberately capped proof used one allowlisted bidder. It proves the requested live lifecycle and a real atomic surplus refund. It does not demonstrate a losing-bidder refund; the existing multi-bidder Core v2 testnet receipts cover that path. The contract remains unaudited for uncapped mainnet value.
