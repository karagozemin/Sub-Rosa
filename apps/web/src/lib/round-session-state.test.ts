import assert from "node:assert/strict";
import { test } from "node:test";

import { getRevealedCount, hasCommittedEntry } from "./round-session-state";

test("keeps a confirmed local commit while the first RPC refresh is stale", () => {
  assert.equal(
    hasCommittedEntry({
      address: "GBIDDER",
      commitValue: 18_0000n,
      bidStates: {},
    }),
    true,
  );
});

test("recognizes an on-chain commit after RPC catches up", () => {
  assert.equal(
    hasCommittedEntry({
      address: "GBIDDER",
      commitValue: null,
      bidStates: { GBIDDER: { revealed_value: null } },
    }),
    true,
  );
});

test("does not mark an uncommitted session as committed", () => {
  assert.equal(
    hasCommittedEntry({
      address: "GBIDDER",
      commitValue: null,
      bidStates: {},
    }),
    false,
  );
});

test("keeps confirmed reveals visible while the next RPC read is stale", () => {
  assert.equal(
    getRevealedCount({
      bidStates: { GBIDDER: { revealed_value: null } },
      confirmedRevealCount: 1,
    }),
    1,
  );
});

test("uses the larger on-chain reveal count after RPC catches up", () => {
  assert.equal(
    getRevealedCount({
      bidStates: {
        GONE: { revealed_value: 10n },
        GTWO: { revealed_value: 20n },
      },
      confirmedRevealCount: 1,
    }),
    2,
  );
});
