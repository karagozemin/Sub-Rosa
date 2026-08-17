import assert from "node:assert/strict";
import { test } from "node:test";

import {
  actaPilotRoundIdFromHash,
  hashFor,
  offerHubPilotRoundIdFromHash,
  openX402PilotRoundIdFromHash,
  pilotRoundIdFromHash,
  publishedReceiptSlugFromHash,
  routeFromHash,
  trustlessWorkPilotRoundIdFromHash,
} from "./routing";

test("pilot routes open the partner workspace", () => {
  assert.deepEqual(routeFromHash("#/pilot"), {
    page: "pilotCatalog",
    useCase: "auction",
  });
  assert.deepEqual(routeFromHash("#/pilot/42"), {
    page: "basicPilot",
    useCase: "auction",
  });
  assert.deepEqual(routeFromHash("#/pilot/basic"), {
    page: "basicPilot",
    useCase: "auction",
  });
  assert.deepEqual(routeFromHash("#/pilot/the-signal"), {
    page: "signalPilot",
    useCase: "auction",
  });
  assert.deepEqual(routeFromHash("#/pilot/trustless-work"), {
    page: "trustlessWorkPilot",
    useCase: "auction",
  });
  assert.deepEqual(routeFromHash("#/pilot/offer-hub"), {
    page: "offerHubPilot",
    useCase: "auction",
  });
  assert.deepEqual(routeFromHash("#/pilot/acta"), {
    page: "actaPilot",
    useCase: "auction",
  });
  assert.deepEqual(routeFromHash("#/pilot/openx402"), {
    page: "openX402Pilot",
    useCase: "auction",
  });
});

test("pilot round links accept only numeric round ids", () => {
  assert.equal(pilotRoundIdFromHash("#/pilot/42"), "42");
  assert.equal(pilotRoundIdFromHash("#pilot/0007"), "0007");
  assert.equal(pilotRoundIdFromHash("#/pilot/not-a-round"), "");
  assert.equal(pilotRoundIdFromHash("#/demo/42"), "");
});

test("pilot navigation emits the canonical workspace hash", () => {
  assert.equal(hashFor("pilotCatalog"), "#/pilot");
  assert.equal(hashFor("basicPilot"), "#/pilot/basic");
  assert.equal(hashFor("signalPilot"), "#/pilot/the-signal");
  assert.equal(hashFor("trustlessWorkPilot"), "#/pilot/trustless-work");
  assert.equal(hashFor("offerHubPilot"), "#/pilot/offer-hub");
  assert.equal(hashFor("actaPilot"), "#/pilot/acta");
  assert.equal(hashFor("openX402Pilot"), "#/pilot/openx402");
});

test("OpenX402 pilot round links accept only numeric round ids", () => {
  assert.equal(openX402PilotRoundIdFromHash("#/pilot/openx402/42"), "42");
  assert.equal(openX402PilotRoundIdFromHash("#pilot/openx402/0007"), "0007");
  assert.equal(openX402PilotRoundIdFromHash("#/pilot/openx402/not-a-round"), "");
});

test("ACTA pilot round links accept only numeric round ids", () => {
  assert.equal(actaPilotRoundIdFromHash("#/pilot/acta/42"), "42");
  assert.equal(actaPilotRoundIdFromHash("#pilot/acta/0007"), "0007");
  assert.equal(actaPilotRoundIdFromHash("#/pilot/acta/not-a-round"), "");
});

test("offer-hub pilot round links accept only numeric round ids", () => {
  assert.equal(offerHubPilotRoundIdFromHash("#/pilot/offer-hub/42"), "42");
  assert.equal(offerHubPilotRoundIdFromHash("#pilot/offer-hub/0007"), "0007");
  assert.equal(offerHubPilotRoundIdFromHash("#/pilot/offer-hub/not-a-round"), "");
});

test("trustless work pilot round links accept only numeric round ids", () => {
  assert.equal(trustlessWorkPilotRoundIdFromHash("#/pilot/trustless-work/42"), "42");
  assert.equal(trustlessWorkPilotRoundIdFromHash("#pilot/trustless-work/0007"), "0007");
  assert.equal(trustlessWorkPilotRoundIdFromHash("#/pilot/trustless-work/not-a-round"), "");
});

test("docs route and navigation use the canonical hash", () => {
  assert.deepEqual(routeFromHash("#/docs"), {
    page: "docs",
    useCase: "auction",
  });
  assert.equal(hashFor("docs"), "#/docs");
});

test("published receipt routes accept stable evidence slugs", () => {
  assert.deepEqual(routeFromHash("#/receipt/instawards-auction-1"), {
    page: "publishedReceipt",
    useCase: "auction",
    receiptSlug: "instawards-auction-1",
  });
  assert.equal(
    publishedReceiptSlugFromHash("#/receipt/instawards-auction-1"),
    "instawards-auction-1",
  );
  assert.equal(publishedReceiptSlugFromHash("#/receipt/INVALID"), "");
});
