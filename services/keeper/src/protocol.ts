import type { SubRosaClient, Round, RoundV2, RevealStateV3 } from "@sub-rosa/sdk";

export type KeeperProtocolVersion = 1 | 2;

// Optional v2 methods preserve compatibility with existing v1 read-only adapters.
export type KeeperReader = Pick<SubRosaClient, "getRound" | "getBidState"> &
  Partial<Pick<SubRosaClient, "getRoundV2" | "getSubmissionV2" | "getRevealStateV3">>;

export function parseKeeperProtocolVersion(
  env: Record<string, string | undefined> = process.env,
): KeeperProtocolVersion {
  const value = env.KEEPER_PROTOCOL_VERSION?.trim() || "2";
  if (value === "1" || value === "2") return Number(value) as KeeperProtocolVersion;
  throw new Error("KEEPER_PROTOCOL_VERSION must be 1 or 2");
}

export function readKeeperRound(
  reader: Pick<KeeperReader, "getRound" | "getRoundV2">,
  roundId: bigint,
  protocolVersion: KeeperProtocolVersion,
) {
  if (protocolVersion === 2) {
    if (!reader.getRoundV2) throw new Error("Core v2 reader requires getRoundV2");
    return reader.getRoundV2(roundId);
  }
  return reader.getRound(roundId);
}

export async function countKeeperRevealed(
  reader: KeeperReader,
  roundId: bigint,
  bidders: string[],
  protocolVersion: KeeperProtocolVersion,
): Promise<number | null> {
  try {
    const revealed = await Promise.all(bidders.map(async (bidder) => {
      if (protocolVersion === 2) {
        if (!reader.getSubmissionV2) throw new Error("Core v2 reader requires getSubmissionV2");
        return (await reader.getSubmissionV2(roundId, bidder)).revealed_envelope != null;
      }
      return (await reader.getBidState(roundId, bidder)).revealed_value != null;
    }));
    return revealed.filter(Boolean).length;
  } catch {
    return null;
  }
}

/** New records require their policy; never silently downgrade on RPC/storage errors. */
export async function readKeeperRevealState(
  reader: Pick<KeeperReader, "getRevealStateV3">,
  roundId: bigint,
  round: Round | RoundV2,
): Promise<RevealStateV3 | undefined> {
  if (!("protocol_version" in round) || round.protocol_version === 2) return undefined;
  if (round.protocol_version !== 3) throw new Error(`unsupported round protocol ${round.protocol_version}`);
  if (!reader.getRevealStateV3) throw new Error("v3 reader requires getRevealStateV3");
  return reader.getRevealStateV3(roundId);
}
