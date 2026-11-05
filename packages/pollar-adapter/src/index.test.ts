import assert from "node:assert/strict";
import test from "node:test";

import {
  Account,
  Address,
  Keypair,
  Networks,
  Operation,
  Transaction,
  TransactionBuilder,
  authorizeEntry,
  hash,
  xdr,
} from "@stellar/stellar-sdk";

import {
  PollarAdapterError,
  createPollarSubRosaClient,
  createPollarSubRosaSigner,
  type PollarSigningClient,
} from "./index.js";
import {
  PollarAuthEntrySubmissionError,
  decodePollarTransactionResult,
} from "./testnet-auth-entry.js";

const wallet = Keypair.random();
const other = Keypair.random();

function unsignedTransaction(source = wallet.publicKey()): Transaction {
  return new TransactionBuilder(new Account(source, "123"), {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.manageData({ name: "sub-rosa-pollar-test", value: "receipt-only" }))
    .setTimeout(300)
    .build();
}

function signTransactionXdr(unsignedXdr: string, signer = wallet): string {
  const transaction = TransactionBuilder.fromXDR(unsignedXdr, Networks.TESTNET);
  assert.ok(transaction instanceof Transaction);
  transaction.sign(signer);
  return transaction.toXDR();
}

function unsignedAuthEntry(address = wallet.publicKey()): xdr.SorobanAuthorizationEntry {
  const contract = Address.contract(Buffer.alloc(32, 7)).toScAddress();
  return new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
      new xdr.SorobanAddressCredentials({
        address: Address.fromString(address).toScAddress(),
        nonce: xdr.Int64.fromString("42"),
        signatureExpirationLedger: 0,
        signature: xdr.ScVal.scvVoid(),
      }),
    ),
    rootInvocation: new xdr.SorobanAuthorizedInvocation({
      function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
        new xdr.InvokeContractArgs({
          contractAddress: contract,
          functionName: "submit_v2",
          args: [],
        }),
      ),
      subInvocations: [],
    }),
  });
}

function authPreimage(
  expiration = 1_100,
  networkPassphrase = Networks.TESTNET,
): xdr.HashIdPreimage {
  const entry = unsignedAuthEntry();
  return xdr.HashIdPreimage.envelopeTypeSorobanAuthorization(
    new xdr.HashIdPreimageSorobanAuthorization({
      networkId: hash(Buffer.from(networkPassphrase)),
      nonce: entry.credentials().address().nonce(),
      signatureExpirationLedger: expiration,
      invocation: entry.rootInvocation(),
    }),
  );
}

function pollarClient(overrides: Partial<PollarSigningClient> = {}): PollarSigningClient {
  const base: PollarSigningClient = {
    getNetwork: () => "testnet",
    getWallet: () => ({
      custody: "internal",
      address: wallet.publicKey(),
      provider: "email",
      chain: "STELLAR",
      provisioning: "READY",
      existsOnStellar: true,
    }),
    signTx: async (unsignedXdr) => ({
      status: "signed",
      signedXdr: signTransactionXdr(unsignedXdr),
      sponsored: false,
    }),
    signAuthEntry: async (entryXdr, { validUntilLedger }) => ({
      status: "signed",
      signedAuthEntry: (
        await authorizeEntry(
          xdr.SorobanAuthorizationEntry.fromXDR(entryXdr, "base64"),
          wallet,
          validUntilLedger,
          Networks.TESTNET,
        )
      ).toXDR("base64"),
    }),
  };
  return { ...base, ...overrides };
}

const ledgerReader = { getLatestLedger: async () => ({ sequence: 1_000 }) };

function expectCode(code: PollarAdapterError["code"]): (error: unknown) => boolean {
  return (error) => error instanceof PollarAdapterError && error.code === code;
}

test("signs a testnet envelope with Pollar and disables sponsorship", async () => {
  let options: { skipSponsorship?: boolean } | undefined;
  const pollar = pollarClient({
    signTx: async (xdr, receivedOptions) => {
      options = receivedOptions;
      return { status: "signed", signedXdr: signTransactionXdr(xdr), sponsored: false };
    },
  });
  const signer = createPollarSubRosaSigner({ pollar, ledgerReader });
  const unsigned = unsignedTransaction().toXDR();
  const result = await signer.signTransaction(unsigned, {
    address: wallet.publicKey(),
    networkPassphrase: Networks.TESTNET,
  });

  assert.deepEqual(options, { skipSponsorship: true });
  assert.equal(result.signerAddress, wallet.publicKey());
  assert.equal((TransactionBuilder.fromXDR(result.signedTxXdr, Networks.TESTNET) as Transaction).signatures.length, 1);
});

test("signs an authorization entry using a fresh live-ledger expiration", async () => {
  let expiration = 0;
  const pollar = pollarClient({
    signAuthEntry: async (entryXdr, options) => {
      expiration = options.validUntilLedger;
      const signed = await authorizeEntry(
        xdr.SorobanAuthorizationEntry.fromXDR(entryXdr, "base64"),
        wallet,
        expiration,
        Networks.TESTNET,
      );
      return { status: "signed", signedAuthEntry: signed.toXDR("base64") };
    },
  });
  const signer = createPollarSubRosaSigner({
    pollar,
    ledgerReader,
    authEntryLedgerTtl: 100,
  });
  const entry = unsignedAuthEntry();
  const signed = await authorizeEntry(
    entry,
    async (preimage) => {
      const result = await signer.signAuthEntry(preimage.toXDR("base64"), {
        address: wallet.publicKey(),
        networkPassphrase: Networks.TESTNET,
      });
      assert.equal(result.signerAddress, wallet.publicKey());
      return {
        publicKey: result.signerAddress,
        signature: Buffer.from(result.signedAuthEntry, "base64"),
      };
    },
    1_075,
    Networks.TESTNET,
  );

  assert.equal(expiration, 1_075);
  assert.equal(signed.credentials().address().signatureExpirationLedger(), 1_075);
  assert.notEqual(signed.credentials().address().signature().switch().name, "scvVoid");
});

test("rejects malformed transaction XDR before calling Pollar", async () => {
  let calls = 0;
  const signer = createPollarSubRosaSigner({
    pollar: pollarClient({
      signTx: async () => {
        calls += 1;
        return { status: "error", details: "should not run" };
      },
    }),
    ledgerReader,
  });
  await assert.rejects(signer.signTransaction("not-xdr"), expectCode("MALFORMED_TRANSACTION_XDR"));
  assert.equal(calls, 0);
});

test("rejects a signature from a different Stellar account", async () => {
  const signer = createPollarSubRosaSigner({
    pollar: pollarClient({
      signTx: async (value) => ({ status: "signed", signedXdr: signTransactionXdr(value, other) }),
    }),
    ledgerReader,
  });
  await assert.rejects(
    signer.signTransaction(unsignedTransaction().toXDR()),
    expectCode("SIGNER_MISMATCH"),
  );
});

test("rejects Pollar fee-bump output", async () => {
  const signer = createPollarSubRosaSigner({
    pollar: pollarClient({
      signTx: async (value) => {
        const inner = TransactionBuilder.fromXDR(value, Networks.TESTNET);
        assert.ok(inner instanceof Transaction);
        inner.sign(wallet);
        const feeBump = TransactionBuilder.buildFeeBumpTransaction(
          other,
          "100",
          inner,
          Networks.TESTNET,
        );
        feeBump.sign(other);
        return { status: "signed", signedXdr: feeBump.toXDR(), sponsored: true };
      },
    }),
    ledgerReader,
  });
  await assert.rejects(
    signer.signTransaction(unsignedTransaction().toXDR()),
    expectCode("FEE_BUMP_UNSUPPORTED"),
  );
});

test("surfaces manual co-sign state instead of claiming success", async () => {
  const signer = createPollarSubRosaSigner({
    pollar: pollarClient({
      signTx: async () => ({
        status: "cosign_pending",
        request: { id: "req-1" } as never,
      }),
    }),
    ledgerReader,
  });
  await assert.rejects(
    signer.signTransaction(unsignedTransaction().toXDR()),
    expectCode("POLLAR_COSIGN_PENDING"),
  );
});

test("rejects a mainnet Pollar client and callback network mismatch", async () => {
  assert.throws(
    () => createPollarSubRosaSigner({ pollar: pollarClient({ getNetwork: () => "mainnet" }), ledgerReader }),
    expectCode("POLLAR_NETWORK_MISMATCH"),
  );
  const signer = createPollarSubRosaSigner({ pollar: pollarClient(), ledgerReader });
  await assert.rejects(
    signer.signTransaction(unsignedTransaction().toXDR(), { networkPassphrase: Networks.PUBLIC }),
    expectCode("POLLAR_NETWORK_MISMATCH"),
  );
  await assert.rejects(
    signer.signAuthEntry(authPreimage(1_075, Networks.PUBLIC).toXDR("base64"), {
      networkPassphrase: Networks.TESTNET,
    }),
    expectCode("POLLAR_NETWORK_MISMATCH"),
  );
});

test("rejects unready, missing, and smart wallets", () => {
  assert.throws(
    () => createPollarSubRosaSigner({ pollar: pollarClient({ getWallet: () => null }), ledgerReader }),
    expectCode("POLLAR_WALLET_MISSING"),
  );
  assert.throws(
    () => createPollarSubRosaSigner({
      pollar: pollarClient({
        getWallet: () => ({ custody: "internal", address: wallet.publicKey(), provider: "email", provisioning: "CREATING" }),
      }),
      ledgerReader,
    }),
    expectCode("POLLAR_WALLET_NOT_READY"),
  );
  assert.throws(
    () => createPollarSubRosaSigner({
      pollar: pollarClient({
        getWallet: () => ({ custody: "smart", address: `C${"A".repeat(55)}`, provider: "passkey" }),
      }),
      ledgerReader,
    }),
    expectCode("POLLAR_WALLET_UNSUPPORTED"),
  );
});

test("rejects a changed active wallet", async () => {
  let current = wallet.publicKey();
  const pollar = pollarClient({
    getWallet: () => ({ custody: "internal", address: current, provider: "email", provisioning: "READY" }),
  });
  const signer = createPollarSubRosaSigner({ pollar, ledgerReader });
  current = other.publicKey();
  await assert.rejects(
    signer.signTransaction(unsignedTransaction().toXDR()),
    expectCode("SIGNER_MISMATCH"),
  );
});

test("preserves Pollar policy errors including backend code", async () => {
  const signer = createPollarSubRosaSigner({
    pollar: pollarClient({
      signAuthEntry: async () => ({
        status: "error",
        code: "CONTRACT_NOT_ALLOWLISTED",
        details: "contract/function policy rejected the invocation",
      }),
    }),
    ledgerReader,
  });
  await assert.rejects(
    signer.signAuthEntry(authPreimage(1_075).toXDR("base64")),
    (error) =>
      error instanceof PollarAdapterError &&
      error.code === "POLLAR_SIGNING_REJECTED" &&
      error.pollarCode === "CONTRACT_NOT_ALLOWLISTED",
  );
});

test("rejects an authorization signature that changes the requested expiration", async () => {
  const signer = createPollarSubRosaSigner({
    pollar: pollarClient({
      signAuthEntry: async (entryXdr) => ({
        status: "signed",
        signedAuthEntry: (
          await authorizeEntry(
            xdr.SorobanAuthorizationEntry.fromXDR(entryXdr, "base64"),
            wallet,
            1_074,
            Networks.TESTNET,
          )
        ).toXDR("base64"),
      }),
    }),
    ledgerReader,
  });
  await assert.rejects(
    signer.signAuthEntry(authPreimage(1_075).toXDR("base64")),
    expectCode("SIGNED_PAYLOAD_MISMATCH"),
  );
});

test("rejects an expired or excessively long authorization request before Pollar", async () => {
  let calls = 0;
  const signer = createPollarSubRosaSigner({
    pollar: pollarClient({
      signAuthEntry: async () => {
        calls += 1;
        return { status: "error", details: "should not run" };
      },
    }),
    ledgerReader,
  });
  await assert.rejects(
    signer.signAuthEntry(authPreimage(1_000).toXDR("base64")),
    expectCode("SIGNED_PAYLOAD_MISMATCH"),
  );
  await assert.rejects(
    signer.signAuthEntry(authPreimage(1_101).toXDR("base64")),
    expectCode("SIGNED_PAYLOAD_MISMATCH"),
  );
  assert.equal(calls, 0);
});

test("rejects malformed authorization preimage XDR before Pollar", async () => {
  let calls = 0;
  const signer = createPollarSubRosaSigner({
    pollar: pollarClient({
      signAuthEntry: async () => {
        calls += 1;
        return { status: "error", details: "should not run" };
      },
    }),
    ledgerReader,
  });
  await assert.rejects(
    signer.signAuthEntry(unsignedAuthEntry().toXDR("base64")),
    expectCode("MALFORMED_AUTH_ENTRY_XDR"),
  );
  assert.equal(calls, 0);
});

test("rejects a different requested authorization signer", async () => {
  const signer = createPollarSubRosaSigner({ pollar: pollarClient(), ledgerReader });
  await assert.rejects(
    signer.signAuthEntry(authPreimage(1_075).toXDR("base64"), {
      address: other.publicKey(),
      networkPassphrase: Networks.TESTNET,
    }),
    expectCode("SIGNER_MISMATCH"),
  );
});

test("does not call Pollar submission APIs", async () => {
  let submissions = 0;
  const pollar = Object.assign(pollarClient(), {
    submitTx: async () => {
      submissions += 1;
    },
    signAndSubmitTx: async () => {
      submissions += 1;
    },
  });
  const signer = createPollarSubRosaSigner({ pollar, ledgerReader });
  await signer.signTransaction(unsignedTransaction().toXDR());
  assert.equal(submissions, 0);
});

test("constructs the real Sub Rosa SDK client with adapter callbacks", () => {
  const { client, signer } = createPollarSubRosaClient({
    pollar: pollarClient(),
    ledgerReader,
  });
  assert.equal(client.contract.options.publicKey, signer.publicKey);
  assert.equal(client.networkPassphrase, Networks.TESTNET);
});

test("enforces the ReceiptOnly write boundary", async () => {
  const { client } = createPollarSubRosaClient({
    pollar: pollarClient(),
    ledgerReader,
  });
  await assert.rejects(
    client.createRoundV2({ mode: "Auction" } as never),
    expectCode("RECEIPT_ONLY_REQUIRED"),
  );
  await assert.rejects(
    client.submitV2({ roundId: 1n, sealed: {} as never, escrow: 1n }),
    expectCode("RECEIPT_ONLY_REQUIRED"),
  );
  await assert.rejects(
    client.settleV2(1n),
    expectCode("RECEIPT_ONLY_REQUIRED"),
  );
});

test("preserves raw Stellar RPC rejection evidence with a stable diagnostic code", () => {
  const error = new PollarAuthEntrySubmissionError({
    status: "ERROR",
    hash: "ab".repeat(32),
    latestLedger: 123,
    latestLedgerCloseTime: 456,
    errorResultXdr: "AAAA",
    errorResultCode: "txSorobanInvalid",
    operationResultCodes: ["opInner:invokeHostFunction:invokeHostFunctionTrapped"],
    diagnosticEventsXdr: ["BBBB"],
    diagnosticEventsDecoded: ["contract error"],
  });

  assert.equal(error.code, "STELLAR_RPC_REJECTED");
  assert.equal(error.rpcResult.errorResultXdr, "AAAA");
  assert.match(error.message, /txSorobanInvalid/);
  assert.doesNotMatch(error.message, /UNKNOWN/);
});

test("decodes nested Soroban sendTransaction rejection codes", () => {
  const hostResult = xdr.InvokeHostFunctionResult.invokeHostFunctionTrapped();
  const operation = xdr.OperationResult.opInner(
    xdr.OperationResultTr.invokeHostFunction(hostResult),
  );
  const result = new xdr.TransactionResult({
    feeCharged: xdr.Int64.fromString("100"),
    result: xdr.TransactionResultResult.txFailed([operation]),
    ext: new xdr.TransactionResultExt(0),
  });

  assert.deepEqual(decodePollarTransactionResult(result.toXDR("base64")), {
    errorResultCode: "txFailed",
    operationResultCodes: ["opInner:invokeHostFunction:invokeHostFunctionTrapped"],
  });
});
