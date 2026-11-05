# Interactive Pollar × Sub Rosa testnet proof

This local browser app establishes a genuine Pollar session and passes the same
`PollarClient` instance directly to `@sub-rosa/pollar-adapter`. It has no local
secret-key signer and no fallback wallet.

## One-time Pollar dashboard setup

1. Open [dashboard.pollar.xyz](https://dashboard.pollar.xyz), sign in, and
   create or select an app.
2. Keep the app on **Testnet**.
3. Under **Build → API Keys**, create/copy a **publishable** testnet key
   (`pub_testnet_...`). Do not use a `sec_testnet_...` secret key.
4. Under **Build → Domains**, add this exact local origin:
   `http://127.0.0.1:4175`.
5. Ensure the app's funding wallet is active. For the simplest proof, use
   immediate account funding. A Pollar G-wallet must exist on testnet and hold
   enough testnet XLM to pay five Soroban fees because the adapter deliberately
   disables fee sponsorship in its first release.
6. For the separate **signAuthEntry** proof, configure the application's
   Soroban authorization allowlist for Stellar testnet with only:
   - contract `CCOVGOQQZJKZ2R55GRWBLTJTGBAMSHXZVN3ICPG3WRVMLMM6RHISC5OV`
   - function `create_partner_round_v2`

   The proof requests an 80-ledger expiry. Do not enable a wildcard. If the
   dashboard does not expose this control, send the tuple and your Pollar
   application ID to the Pollar operator for configuration.

## Local configuration

```bash
cd examples/pollar-e2e
cp .env.example .env.local
```

Set only:

```dotenv
VITE_POLLAR_PUBLISHABLE_KEY=pub_testnet_your_key
```

Anything prefixed with `VITE_` is bundled into the browser. Never place a
Pollar secret key, refresh token, DPoP material, wallet secret, or OTP in the
environment file.

## Run

From the repository root:

```bash
pnpm install
pnpm pollar-e2e:dev
```

Open `http://127.0.0.1:4175` in the same browser you will use for login.

1. Enter your email and press **Send OTP** (or choose Google, GitHub,
   Freighter, or Albedo).
2. Enter the OTP and press **Verify OTP**.
3. Wait until the wallet is a classic `G...` address and provisioning reports
   `READY`. The page also checks its public testnet XLM balance.
4. Press **Run real Pollar E2E**.
5. Approve each of the five signature prompts. Raw XDR is intentionally hidden;
   the adapter independently validates the network, source, transaction body,
   fee-bump status, and returned Ed25519 signature.
6. Keep the tab open while it waits for Drand and the reveal deadline. Default
   timing gives three minutes to approve create + commit and roughly three more
   minutes for reveal/clear.
7. Download the resulting evidence JSON. It contains only public testnet data:
   signer address, contract/round IDs, transaction hashes, RPC statuses,
   receipt hash, and verification status.
8. Press **Run real Pollar signAuthEntry test** for the independent non-source
   authorization proof. The transient sponsor secret stays in memory and can
   sign only the fee envelope; the Pollar wallet must sign its own auth entry.

DPoP keys and session tokens remain in Pollar's browser storage/key manager for
this origin. The UI never assigns the client to `window`, never renders tokens,
and never exports raw signed payloads. Use **Log out** when finished.

## Failure diagnostics

The UI reports a sanitized category and SDK code:

- `account`: missing/unfunded/unready G-address or wallet provisioning issue
- `policy`: Pollar application transaction-policy rejection
- `network`: CORS, timeout, RPC, Horizon, or wrong-network issue
- `XDR/signature`: malformed XDR, fee bump, changed payload, or wrong signer
- `Pollar API/auth`: API key, origin, OTP, session, or authentication failure

An HTTP 403 `SOROBAN_AUTH_NO_POLICY` response at `sign_auth_entry` means the
request reached Pollar but the selected application has no Soroban auth-entry
allowlist. Configure the exact tuple above and rerun. No Stellar transaction is
submitted when signing is rejected.

`SOROBAN_AUTH_SIGN_FAILED` with `unknown StellarValueType member for value 3`
means policy validation passed but Pollar's backend signer could not decode the
newer testnet ledger header. No local retry or alternate signer should be used;
wait for Pollar's backend compatibility update and rerun the same proof.

There is no alternate signer. A failure must be fixed at its actual source and
the real Pollar flow rerun.
