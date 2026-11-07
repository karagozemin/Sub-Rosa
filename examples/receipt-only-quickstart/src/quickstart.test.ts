import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSchedule,
  requiredEnvironment,
  testnetTransactionUrl,
} from "./quickstart.js";

test("deadline calculation uses Drand round 1 at genesis", () => {
  const schedule = buildSchedule(
    11,
    { genesis_time: 1_000, period: 3 },
    995,
  );
  assert.deepEqual(schedule, {
    revealAt: 1_030,
    commitDeadline: 1_000,
    revealDeadline: 1_120,
  });
});

test("invalid or missing quickstart environment fails before network access", () => {
  assert.throws(() => requiredEnvironment({}), /missing STELLAR_SECRET_KEY/);
  assert.deepEqual(requiredEnvironment({ STELLAR_SECRET_KEY: " STEST " }), {
    secretKey: "STEST",
  });
  assert.deepEqual(
    requiredEnvironment({
      STELLAR_SECRET_KEY: "STEST",
      ROUND_CONTRACT_ID: " CTEST ",
    }),
    { secretKey: "STEST", contractId: "CTEST" },
  );
});

test("transaction evidence points to the Stellar testnet explorer", () => {
  assert.equal(
    testnetTransactionUrl("abc123"),
    "https://stellar.expert/explorer/testnet/tx/abc123",
  );
});
