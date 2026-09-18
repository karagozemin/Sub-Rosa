import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { rpc, StrKey } from "@stellar/stellar-sdk";

import { SubRosaClient } from "./client.js";
import {
  SubRosaClientConfigError,
  SubRosaSubmitError,
} from "./errors.js";
import type {
  SubmitSignedTransactionParams,
  TransactionSubmitter,
} from "./submitter.js";

const BASE_CONFIG = {
  rpcUrl: "https://example.com",
  networkPassphrase: "Test SDF Network ; September 2015",
  contractId: StrKey.encodeContract(Buffer.alloc(32)),
  _server: {
    getNetwork: async () => ({
      passphrase: "Test SDF Network ; September 2015",
      protocolVersion: "23",
    }),
    getLedgerEntries: async () => ({
      entries: [{}],
      latestLedger: 123,
    }),
  } as unknown as rpc.Server,
};

const PUBLIC_KEY =
  "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

function assertConfigError(
  createClient: () => SubRosaClient,
  message: RegExp,
): void {
  assert.throws(createClient, (error: unknown) => {
    assert.ok(error instanceof SubRosaClientConfigError);
    assert.match(error.message, message);
    return true;
  });
}

describe("SubRosaClient network configuration", () => {
  it("constructs from the official testnet preset", () => {
    const client = new SubRosaClient({
      network: "testnet",
      _server: BASE_CONFIG._server,
    });
    assert.equal(
      client.contractId,
      "CCOVGOQQZJKZ2R55GRWBLTJTGBAMSHXZVN3ICPG3WRVMLMM6RHISC5OV",
    );
    assert.equal(client.networkPassphrase, BASE_CONFIG.networkPassphrase);
  });

  it("constructs from the official mainnet Core v2 preset", () => {
    const client = new SubRosaClient({ network: "mainnet" });
    assert.equal(
      client.contractId,
      "CDQOFNCJE5Z4ZZL76DU5652FOUKJVEIZWHFGCZVWH63UYBGPSZIPC325",
    );
    assert.equal(
      client.networkPassphrase,
      "Public Global Stellar Network ; September 2015",
    );
  });

  it("rejects an HTTP RPC URL with a typed error by default", () => {
    assertConfigError(
      () =>
        new SubRosaClient({
          ...BASE_CONFIG,
          rpcUrl: "http://localhost:8000",
        }),
      /rpcUrl must use https unless allowHttp is explicitly enabled/,
    );
  });

  it("rejects an HTTP RPC URL when allowHttp is explicitly false", () => {
    assertConfigError(
      () =>
        new SubRosaClient({
          ...BASE_CONFIG,
          rpcUrl: "http://localhost:8000",
          allowHttp: false,
        }),
      /rpcUrl must use https unless allowHttp is explicitly enabled/,
    );
  });

  it("accepts an HTTP RPC URL when allowHttp is explicitly enabled", () => {
    assert.doesNotThrow(
      () =>
        new SubRosaClient({
          ...BASE_CONFIG,
          rpcUrl: "http://localhost:8000",
          allowHttp: true,
        }),
    );
  });

  it("rejects a mismatched RPC before building a contract call", async () => {
    let contractCalls = 0;
    const client = new SubRosaClient({
      ...BASE_CONFIG,
      _server: {
        getNetwork: async () => ({
          passphrase: "Public Global Stellar Network ; September 2015",
          protocolVersion: "23",
        }),
        getLedgerEntries: async () => ({ entries: [], latestLedger: 123 }),
      } as unknown as rpc.Server,
    });
    Object.defineProperty(client.contract, "get_round", {
      configurable: true,
      value: async () => {
        contractCalls += 1;
        throw new Error("must not be reached");
      },
    });

    await assert.rejects(client.getRound(1), /same deployment/);
    assert.equal(contractCalls, 0);
  });

  it("caches successful first-use validation", async () => {
    let networkLookups = 0;
    let contractLookups = 0;
    const client = new SubRosaClient({
      ...BASE_CONFIG,
      _server: {
        getNetwork: async () => {
          networkLookups += 1;
          return {
            passphrase: BASE_CONFIG.networkPassphrase,
            protocolVersion: "23",
          };
        },
        getLedgerEntries: async () => {
          contractLookups += 1;
          return { entries: [{}], latestLedger: 123 };
        },
      } as unknown as rpc.Server,
    });
    Object.defineProperty(client.contract, "get_round", {
      configurable: true,
      value: async () => ({ result: { unwrap: () => ({}) } }),
    });

    await client.getRound(1);
    await client.getRound(2);

    assert.equal(networkLookups, 1);
    assert.equal(contractLookups, 1);
  });
});

describe("SubRosaClient transaction evidence", () => {
  it("records hashes for successful direct RPC submissions", async () => {
    const client = new SubRosaClient({
      ...BASE_CONFIG,
      publicKey: PUBLIC_KEY,
    });
    Object.defineProperty(client.contract, "clear", {
      configurable: true,
      value: async () => ({
        async signAndSend() {
          return {
            result: { unwrap: () => undefined },
            sendTransactionResponse: { hash: "abc123" },
          };
        },
      }),
    });

    await client.clear(1);
    assert.deepEqual(client.submittedTransactionHashes, ["abc123"]);
    assert.notEqual(
      client.submittedTransactionHashes,
      client.submittedTransactionHashes,
    );
  });
});

describe("SubRosaClient Core v2 deployment compatibility", () => {
  it("treats a missing policy view as a pre-policy Core v2 round", async () => {
    const client = new SubRosaClient(BASE_CONFIG);
    Object.defineProperty(client.contract, "get_round_policy_v2", {
      configurable: true,
      value: async () => {
        throw new Error(
          "HostError: trying to invoke non-existent contract function get_round_policy_v2",
        );
      },
    });

    assert.equal(await client.getRoundPolicyV2(7), undefined);
  });

  it("does not hide unrelated policy read failures", async () => {
    const client = new SubRosaClient(BASE_CONFIG);
    Object.defineProperty(client.contract, "get_round_policy_v2", {
      configurable: true,
      value: async () => {
        throw new Error("HostError: storage MissingValue");
      },
    });

    await assert.rejects(client.getRoundPolicyV2(7), /storage MissingValue/);
  });
});

describe("SubRosaClient source configuration", () => {
  it("accepts wallet signing adapters with their public source", () => {
    const signTransaction = async () => ({ signedTxXdr: "AAAA" });
    const signAuthEntry = async () => ({ signedAuthEntry: "BBBB" });
    const client = new SubRosaClient({
      ...BASE_CONFIG,
      publicKey: PUBLIC_KEY,
      signTransaction,
      signAuthEntry,
    });
    assert.equal(client.contract.options.signTransaction, signTransaction);
    assert.equal(client.contract.options.signAuthEntry, signAuthEntry);
  });

  it("rejects ambiguous or source-less wallet signing configuration", () => {
    assertConfigError(
      () =>
        new SubRosaClient({
          ...BASE_CONFIG,
          signTransaction: async () => ({ signedTxXdr: "AAAA" }),
        }),
      /publicKey is required/,
    );
    assertConfigError(
      () =>
        new SubRosaClient({
          ...BASE_CONFIG,
          secretKey:
            "SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
          signTransaction: async () => ({ signedTxXdr: "AAAA" }),
        }),
      /either secretKey or wallet signing callbacks/,
    );
  });

  it("rejects createRound without an operator source using a typed error", async () => {
    const client = new SubRosaClient(BASE_CONFIG);

    await assert.rejects(
      client.createRound({
        itemRef: new Uint8Array(32),
        revealRound: 1,
        commitDeadline: 2,
        revealDeadline: 3,
        auditorPubkey: new Uint8Array(96),
      }),
      (error: unknown) => {
        assert.ok(error instanceof SubRosaClientConfigError);
        assert.match(error.message, /required to use it as the operator/);
        return true;
      },
    );
  });

  it("rejects commit without a bidder source using a typed error", async () => {
    const client = new SubRosaClient(BASE_CONFIG);

    await assert.rejects(
      client.commit({
        roundId: 1,
        sealed: {
          commitment: new Uint8Array(32),
          ciphertext: new Uint8Array([0x61, 0x67, 0x65]), // non-empty
          auditorBlob: new Uint8Array(1), // non-empty
        },
        escrow: 1n,
      }),
      (error: unknown) => {
        assert.ok(error instanceof SubRosaClientConfigError);
        assert.match(error.message, /required to use it as the bidder/);
        return true;
      },
    );
  });

  it("rejects createRoundV2 without an operator source", async () => {
    const client = new SubRosaClient(BASE_CONFIG);

    await assert.rejects(
      client.createRoundV2({
        itemRef: new Uint8Array(32),
        schemaRef: new Uint8Array(32),
        mode: "ReceiptOnly",
        revealRound: 1,
        commitDeadline: 2,
        revealDeadline: 3,
        auditorPubkey: new Uint8Array(96),
      }),
      /required to use it as the operator/,
    );
  });

  it("rejects an out-of-range Core v2 participant cap before RPC", async () => {
    const client = new SubRosaClient({ ...BASE_CONFIG, publicKey: PUBLIC_KEY });

    await assert.rejects(
      client.createRoundV2({
        itemRef: new Uint8Array(32),
        schemaRef: new Uint8Array(32),
        mode: "Auction",
        revealRound: 1,
        commitDeadline: 2,
        revealDeadline: 3,
        auditorPubkey: new Uint8Array(96),
        maxParticipants: 26,
      }),
      /maxParticipants must be an integer between 1 and 25/,
    );
  });

  it("requires complete custody config for Auction rounds", async () => {
    const client = new SubRosaClient({ ...BASE_CONFIG, publicKey: PUBLIC_KEY });

    await assert.rejects(
      client.createRoundV2({
        itemRef: new Uint8Array(32),
        schemaRef: new Uint8Array(32),
        mode: "Auction",
        revealRound: 1,
        commitDeadline: 2,
        revealDeadline: 3,
        auditorPubkey: new Uint8Array(96),
      }),
      /require paymentAsset, lotAsset, and a positive lotAmount/,
    );
  });

  it("rejects settlement config for ReceiptOnly rounds", async () => {
    const client = new SubRosaClient({ ...BASE_CONFIG, publicKey: PUBLIC_KEY });

    await assert.rejects(
      client.createRoundV2({
        itemRef: new Uint8Array(32),
        schemaRef: new Uint8Array(32),
        mode: "ReceiptOnly",
        paymentAsset: PUBLIC_KEY,
        revealRound: 1,
        commitDeadline: 2,
        revealDeadline: 3,
        auditorPubkey: new Uint8Array(96),
      }),
      /cannot configure payment or lot settlement/,
    );
  });

  it("validates partner fixed escrow and eligibility before RPC", async () => {
    const client = new SubRosaClient({ ...BASE_CONFIG, publicKey: PUBLIC_KEY });
    const shared = {
      itemRef: new Uint8Array(32),
      schemaRef: new Uint8Array(32),
      revealRound: 1,
      commitDeadline: 2,
      revealDeadline: 3,
      auditorPubkey: new Uint8Array(96),
      operator: PUBLIC_KEY,
    };

    await assert.rejects(
      client.createPartnerRoundV2({
        ...shared,
        mode: "Auction",
        paymentAsset: PUBLIC_KEY,
        lotAsset: PUBLIC_KEY,
        lotAmount: 1n,
        fixedEscrow: 0n,
      }),
      /positive fixedEscrow/,
    );
    await assert.rejects(
      client.createPartnerRoundV2({
        ...shared,
        mode: "ReceiptOnly",
        fixedEscrow: 0n,
        eligibleParticipants: [PUBLIC_KEY, PUBLIC_KEY],
      }),
      /cannot contain duplicates/,
    );
  });
});

describe("SubRosaClient external submitter failures", () => {
  it("passes client options and wraps failures with name and cause", async () => {
    const cause = new Error("relayer offline");
    let received: SubmitSignedTransactionParams | undefined;
    const submitter: TransactionSubmitter = {
      name: "test-submitter",
      async submitSignedTransaction(params) {
        received = params;
        throw cause;
      },
    };
    const client = new SubRosaClient({
      ...BASE_CONFIG,
      publicKey: PUBLIC_KEY,
      submitter,
    });
    const fakeTransaction = {
      signed: {
        toXDR: () => "AAAA",
      },
      async sign() {},
      options: {
        parseResultXdr: () => {
          throw new Error("not reached");
        },
      },
    };

    Object.defineProperty(client.contract, "clear", {
      configurable: true,
      value: async () => fakeTransaction,
    });

    await assert.rejects(client.clear(1), (error: unknown) => {
      assert.ok(error instanceof SubRosaSubmitError);
      assert.match(error.message, /test-submitter failed to submit transaction/);
      assert.equal(error.cause, cause);
      return true;
    });
    assert.deepEqual(received, {
      signedTransactionXdr: "AAAA",
      contractId: BASE_CONFIG.contractId,
      networkPassphrase: BASE_CONFIG.networkPassphrase,
      rpcUrl: BASE_CONFIG.rpcUrl,
    });
  });
});


describe("Owner-triggered API", () => {
  it("capability check falls back only for an explicitly absent function", async () => {
    const client = new SubRosaClient(BASE_CONFIG);
    client.contract.protocol_version = async () => ({ result: 3 }) as any;
    assert.equal(await client.supportsRevealPolicy(), true);
    client.contract.protocol_version = async () => { throw new Error("protocol_version: trying to invoke non-existent contract function"); };
    assert.equal(await client.supportsRevealPolicy(), false);
    client.contract.protocol_version = async () => { throw new Error("RPC offline"); };
    await assert.rejects(client.supportsRevealPolicy(), /RPC offline/);
  });

  it("rejects an insufficient reveal window before any transaction submission", async () => {
    const client = new SubRosaClient({ ...BASE_CONFIG, publicKey: PUBLIC_KEY });
    await assert.rejects(client.createRoundV3({
      itemRef: new Uint8Array(32), schemaRef: new Uint8Array(32), mode: "ReceiptOnly",
      revealRound: 10, commitDeadline: 1000, revealDeadline: 1500, auditorPubkey: new Uint8Array(), fixedEscrow: 0n,
      revealPolicy: { type: "owner-triggered", fallbackAt: 1201 },
    }), /at least 300 seconds/);
  });

  it("preflights v3 with the same policy arguments used by creation", async () => {
    const client = new SubRosaClient({ ...BASE_CONFIG, publicKey: PUBLIC_KEY });
    let captured: any;
    client.contract.create_round_v3 = async (args) => {
      captured = args;
      return { result: { unwrap: () => 9n }, simulation: { transactionData: undefined } } as any;
    };
    const result = await client.preflightCreateRoundV3({
      itemRef: new Uint8Array(32), schemaRef: new Uint8Array(32), mode: "ReceiptOnly",
      revealRound: 10, commitDeadline: 1000, revealDeadline: 1500, auditorPubkey: new Uint8Array(), fixedEscrow: 0n,
      revealPolicy: { type: "owner-triggered", fallbackAt: 1200 },
    });
    assert.equal(captured.operator, PUBLIC_KEY);
    assert.deepEqual(captured.policy.reveal, { tag: "OwnerTriggered", values: [1200n] });
    assert.equal(result.operation, "create_round_v3");
  });
});
