import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SubRosaClientConfigError } from "./errors.js";
import {
  SUB_ROSA_DEPLOYMENTS,
  SUB_ROSA_REVEAL_POLICY_V3_DEPLOYMENTS,
  contractExplorerUrl,
  isSubRosaNetwork,
  resolveRevealPolicyV3Deployment,
  resolveSubRosaDeployment,
  transactionExplorerUrl,
} from "./deployments.js";

describe("Sub Rosa network deployments", () => {
  it("resolves the official Core v2 testnet deployment", () => {
    const deployment = resolveSubRosaDeployment("testnet");
    assert.equal(deployment.status, "active");
    assert.equal(deployment.official, true);
    assert.equal(deployment.contractId, SUB_ROSA_DEPLOYMENTS.testnet.contractId);
  });

  it("resolves the official Core v2 mainnet deployment", () => {
    const deployment = resolveSubRosaDeployment("mainnet");
    assert.equal(deployment.status, "active");
    assert.equal(deployment.official, true);
    assert.equal(
      deployment.contractId,
      "CDQOFNCJE5Z4ZZL76DU5652FOUKJVEIZWHFGCZVWH63UYBGPSZIPC325",
    );
  });

  it("accepts a caller-owned mainnet Core v2 deployment", () => {
    const contractId = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHK3M";
    const deployment = resolveSubRosaDeployment("mainnet", {
      contractId,
      rpcUrl: "https://mainnet-rpc.example.com/",
    });
    assert.equal(deployment.contractId, contractId);
    assert.equal(deployment.rpcUrl, "https://mainnet-rpc.example.com/");
    assert.equal(deployment.official, false);
  });

  it("rejects a passphrase that conflicts with the named network", () => {
    assert.throws(
      () =>
        resolveSubRosaDeployment("mainnet", {
          contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHK3M",
          networkPassphrase: SUB_ROSA_DEPLOYMENTS.testnet.networkPassphrase,
        }),
      /network=mainnet requires/,
    );
  });

  it("rejects the known legacy v1 proof as a Core v2 mainnet override", () => {
    assert.throws(
      () =>
        resolveSubRosaDeployment("mainnet", {
          contractId: "CA7KSDEYJEPGZEB2ZROTLUWKQQ6GIRIQNGG6Z745MZ34QHP4UJPWODEX",
        }),
      /legacy v1 settlement proof/,
    );
  });

  it("builds network-correct explorer links", () => {
    assert.equal(
      contractExplorerUrl("testnet", "C123"),
      "https://stellar.expert/explorer/testnet/contract/C123",
    );
    assert.equal(
      transactionExplorerUrl("mainnet", "abc"),
      "https://stellar.expert/explorer/public/tx/abc",
    );
  });

  it("recognizes only supported public networks", () => {
    assert.equal(isSubRosaNetwork("testnet"), true);
    assert.equal(isSubRosaNetwork("mainnet"), true);
    assert.equal(isSubRosaNetwork("futurenet"), false);
  });

  it("keeps the Core v2 defaults independent of reveal-policy-v3", () => {
    assert.equal(SUB_ROSA_DEPLOYMENTS.testnet.protocolVersion, "core-v2");
    assert.notEqual(
      resolveSubRosaDeployment("testnet").contractId,
      SUB_ROSA_REVEAL_POLICY_V3_DEPLOYMENTS.testnet.contractId,
    );
  });

  it("resolves the reveal-policy-v3 testnet deployment as an explicit opt-in", () => {
    const deployment = resolveRevealPolicyV3Deployment("testnet");
    assert.equal(deployment.protocolVersion, "reveal-policy-v3");
    assert.equal(deployment.status, "active");
    assert.equal(deployment.official, true);
    assert.equal(
      deployment.contractId,
      "CB7VIYY4RQLZG2Y6HLDWB3UKSVOAIDYFZ5TGW5AUBCIPJHTCZV4ZWQFF",
    );
  });

  it("requires a caller-owned contract for reveal-policy-v3 mainnet (pending review)", () => {
    assert.throws(
      () => resolveRevealPolicyV3Deployment("mainnet"),
      /no reveal-policy-v3 mainnet contract is configured/,
    );
    const contractId = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHK3M";
    const deployment = resolveRevealPolicyV3Deployment("mainnet", { contractId });
    assert.equal(deployment.contractId, contractId);
    assert.equal(deployment.official, false);
  });
});
