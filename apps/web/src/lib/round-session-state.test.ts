import assert from "node:assert/strict";
import { test } from "node:test";

import { hasCommittedEntry } from "./round-session-state";

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
