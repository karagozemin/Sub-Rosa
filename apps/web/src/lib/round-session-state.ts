/**
 * Treat a locally confirmed commit as authoritative while RPC/indexed reads
 * catch up. The local value is cleared whenever the user creates or joins a
 * different round, so it cannot leak across round sessions.
 */
export function hasCommittedEntry(input: {
  address: string | null;
  commitValue: bigint | null;
  bidStates: Record<string, unknown> | null | undefined;
}): boolean {
  if (input.commitValue != null) return true;
  return Boolean(input.address && input.bidStates?.[input.address]);
}

/**
 * A successful reveal transaction is authoritative even if the following RPC
 * read still returns the pre-reveal bid states for a short time.
 */
export function getRevealedCount(input: {
  bidStates: Record<string, { revealed_value?: unknown | null }> | null | undefined;
  confirmedRevealCount: number;
}): number {
  const onChainCount = Object.values(input.bidStates ?? {}).filter(
    (state) => state.revealed_value != null,
  ).length;
  return Math.max(onChainCount, input.confirmedRevealCount);
}
