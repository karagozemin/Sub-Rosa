import { SubRosaClientConfigError } from "./errors.js";

export type SubRosaNetwork = "testnet" | "mainnet";
export type DeploymentStatus = "active" | "pending";
export type ProtocolVersion = "core-v2" | "reveal-policy-v3";

export interface SubRosaDeployment {
  network: SubRosaNetwork;
  networkLabel: string;
  networkPassphrase: string;
  rpcUrl: string;
  explorerNetwork: "testnet" | "public";
  protocolVersion: ProtocolVersion;
  status: DeploymentStatus;
  contractId: string | null;
  wasmHash: string;
}

export interface ResolveDeploymentOptions {
  contractId?: string;
  rpcUrl?: string;
  networkPassphrase?: string;
}

export interface ResolvedSubRosaDeployment
  extends Omit<SubRosaDeployment, "contractId"> {
  contractId: string;
  official: boolean;
}

const CORE_V2_WASM_HASH =
  "2c7bc6b4c91940ac185df38a3d0a8532b555140d818df94f03f894e5952ebf42";
export const REVEAL_POLICY_V3_WASM_HASH =
  "7a72a82c2678eccaa2f6f3727d4d972640cbabc54f04124c6fc8b68bf150b194";
const LEGACY_V1_MAINNET_CONTRACT =
  "CA7KSDEYJEPGZEB2ZROTLUWKQQ6GIRIQNGG6Z745MZ34QHP4UJPWODEX";

/**
 * Canonical Core v2 deployments. The legacy v1 proof is intentionally not
 * used as a Core v2 default.
 */
export const SUB_ROSA_DEPLOYMENTS = {
  testnet: {
    network: "testnet",
    networkLabel: "Stellar Testnet",
    networkPassphrase: "Test SDF Network ; September 2015",
    rpcUrl: "https://soroban-testnet.stellar.org",
    explorerNetwork: "testnet",
    protocolVersion: "core-v2",
    status: "active",
    contractId: "CCOVGOQQZJKZ2R55GRWBLTJTGBAMSHXZVN3ICPG3WRVMLMM6RHISC5OV",
    wasmHash: CORE_V2_WASM_HASH,
  },
  mainnet: {
    network: "mainnet",
    networkLabel: "Stellar Mainnet",
    networkPassphrase: "Public Global Stellar Network ; September 2015",
    rpcUrl: "https://mainnet.sorobanrpc.com",
    explorerNetwork: "public",
    protocolVersion: "core-v2",
    status: "active",
    contractId: "CDQOFNCJE5Z4ZZL76DU5652FOUKJVEIZWHFGCZVWH63UYBGPSZIPC325",
    wasmHash: CORE_V2_WASM_HASH,
  },
} as const satisfies Record<SubRosaNetwork, SubRosaDeployment>;

export function isSubRosaNetwork(value: unknown): value is SubRosaNetwork {
  return value === "testnet" || value === "mainnet";
}

export function resolveSubRosaDeployment(
  network: SubRosaNetwork,
  options: ResolveDeploymentOptions = {},
): ResolvedSubRosaDeployment {
  const deployment = SUB_ROSA_DEPLOYMENTS[network];
  if (
    options.networkPassphrase &&
    options.networkPassphrase !== deployment.networkPassphrase
  ) {
    throw new SubRosaClientConfigError(
      `network=${network} requires ${JSON.stringify(deployment.networkPassphrase)}; ` +
        `received ${JSON.stringify(options.networkPassphrase)}`,
    );
  }

  const contractId = options.contractId?.trim() || deployment.contractId;
  if (!contractId) {
    throw new SubRosaClientConfigError(
      `no Core v2 ${network} contract is configured; provide contractId for ` +
        "your own reviewed deployment",
    );
  }
  if (network === "mainnet" && contractId === LEGACY_V1_MAINNET_CONTRACT) {
    throw new SubRosaClientConfigError(
      "the supplied mainnet contract is the legacy v1 settlement proof; provide a Core v2 deployment",
    );
  }

  return {
    ...deployment,
    rpcUrl: options.rpcUrl?.trim() || deployment.rpcUrl,
    networkPassphrase: deployment.networkPassphrase,
    contractId,
    official: contractId === deployment.contractId,
  };
}

/**
 * Owner-Triggered Reveal (protocol 3) deployments. These are intentionally NOT
 * the SDK defaults: `resolveSubRosaDeployment` and `new SubRosaClient({ network })`
 * keep resolving to the reviewed Core v2 contracts above. Opt in explicitly by
 * passing this contract id, per docs/REVEAL_POLICY.md rollout step 7. Mainnet is
 * pending an independent funds-handling review, so it has no configured contract.
 */
export const SUB_ROSA_REVEAL_POLICY_V3_DEPLOYMENTS = {
  testnet: {
    network: "testnet",
    networkLabel: "Stellar Testnet",
    networkPassphrase: "Test SDF Network ; September 2015",
    rpcUrl: "https://soroban-testnet.stellar.org",
    explorerNetwork: "testnet",
    protocolVersion: "reveal-policy-v3",
    status: "active",
    contractId: "CB7VIYY4RQLZG2Y6HLDWB3UKSVOAIDYFZ5TGW5AUBCIPJHTCZV4ZWQFF",
    wasmHash: REVEAL_POLICY_V3_WASM_HASH,
  },
  mainnet: {
    network: "mainnet",
    networkLabel: "Stellar Mainnet",
    networkPassphrase: "Public Global Stellar Network ; September 2015",
    rpcUrl: "https://mainnet.sorobanrpc.com",
    explorerNetwork: "public",
    protocolVersion: "reveal-policy-v3",
    status: "pending",
    contractId: null,
    wasmHash: REVEAL_POLICY_V3_WASM_HASH,
  },
} as const satisfies Record<SubRosaNetwork, SubRosaDeployment>;

/**
 * Resolve an Owner-Triggered Reveal (protocol 3) deployment. This is a separate,
 * explicit opt-in from the Core v2 defaults; callers must reach it deliberately.
 * On networks with no published v3 contract (mainnet, pending review) a
 * caller-owned `contractId` is required.
 */
export function resolveRevealPolicyV3Deployment(
  network: SubRosaNetwork,
  options: ResolveDeploymentOptions = {},
): ResolvedSubRosaDeployment {
  const deployment = SUB_ROSA_REVEAL_POLICY_V3_DEPLOYMENTS[network];
  if (
    options.networkPassphrase &&
    options.networkPassphrase !== deployment.networkPassphrase
  ) {
    throw new SubRosaClientConfigError(
      `network=${network} requires ${JSON.stringify(deployment.networkPassphrase)}; ` +
        `received ${JSON.stringify(options.networkPassphrase)}`,
    );
  }

  const contractId = options.contractId?.trim() || deployment.contractId;
  if (!contractId) {
    throw new SubRosaClientConfigError(
      `no reveal-policy-v3 ${network} contract is configured; provide contractId for ` +
        "your own reviewed deployment",
    );
  }

  return {
    ...deployment,
    rpcUrl: options.rpcUrl?.trim() || deployment.rpcUrl,
    networkPassphrase: deployment.networkPassphrase,
    contractId,
    official: contractId === deployment.contractId,
  };
}

export function contractExplorerUrl(
  network: SubRosaNetwork,
  contractId: string,
): string {
  const explorerNetwork = SUB_ROSA_DEPLOYMENTS[network].explorerNetwork;
  return `https://stellar.expert/explorer/${explorerNetwork}/contract/${contractId}`;
}

export function transactionExplorerUrl(
  network: SubRosaNetwork,
  transactionHash: string,
): string {
  const explorerNetwork = SUB_ROSA_DEPLOYMENTS[network].explorerNetwork;
  return `https://stellar.expert/explorer/${explorerNetwork}/tx/${transactionHash}`;
}
