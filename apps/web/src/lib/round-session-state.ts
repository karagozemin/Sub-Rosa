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
