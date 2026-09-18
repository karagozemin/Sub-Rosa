import { drandRoundTime } from "@sub-rosa/tlock";
import { createHash } from "node:crypto";

import { Keypair } from "@stellar/stellar-sdk";
import {
  fetchRoundSignature,
  generateAuditorKeypair,
  openPayload,
  quicknet,
} from "@sub-rosa/tlock";

import {
  createSealedProposalRound,
  sealProposal,
  SubRosaClient,
  verifyReceiptV2,
} from "../src/index.js";

const RPC_URL = "https://soroban-testnet.stellar.org";
const NETWORK = "Test SDF Network ; September 2015";
const DEFAULT_CONTRACT_ID = "CCOVGOQQZJKZ2R55GRWBLTJTGBAMSHXZVN3ICPG3WRVMLMM6RHISC5OV";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing required env var ${name}`);
  return value;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitUntil(timestamp: number): Promise<void> {
  while (Math.floor(Date.now() / 1000) <= timestamp) {
    await sleep(Math.min(3_000, (timestamp + 1 - Math.floor(Date.now() / 1000)) * 1_000));
  }
}

async function clearAfterLedgerCatchup(
  client: SubRosaClient,
  roundId: bigint,
): Promise<void> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const preflight = await client.preflightClearV2(roundId);
    if (preflight.ok) {
      await client.clearV2(roundId);
      return;
    }
    if (!preflight.error.message.includes("#16")) throw preflight.error;
    await sleep(5_000);
  }
  throw new Error("ledger did not advance past reveal_deadline before timeout");
}

async function main() {
  const secretKey = required("OPERATOR_SECRET");
  const contractId = process.env.ROUND_CONTRACT_ID ?? DEFAULT_CONTRACT_ID;
  const participant = Keypair.fromSecret(secretKey).publicKey();
  const client = new SubRosaClient({
    rpcUrl: RPC_URL,
    networkPassphrase: NETWORK,
    contractId,
    secretKey,
  });
  const drand = quicknet();
  const chain = await drand.chain().info();
  const now = Math.floor(Date.now() / 1000);
  const revealRound = Math.ceil((now + 30 - Number(chain.genesis_time)) / Number(chain.period)) + 1;
  const revealAt = drandRoundTime(revealRound, chain);
  const commitDeadline = now + 15;
  // Soroban testnet ledgers close roughly every five seconds. Leave enough
  // room for open_reveal, seal read/decrypt, and reveal to land separately.
  const revealDeadline = revealAt + 35;
  const auditor = generateAuditorKeypair();

  const roundId = await createSealedProposalRound(client, {
    itemRef: createHash("sha256").update("sub-rosa://pilot/the-signal/v2-smoke").digest(),
    revealRound,
    commitDeadline,
    revealDeadline,
    auditorPubkey: auditor.publicKey,
    maxParticipants: 5,
    eligibleParticipants: [participant],
  });
  console.log(`created round ${roundId} (ReceiptOnly, R=${revealRound})`);

  const sealed = await sealProposal({
    round: revealRound,
    drand,
    identity: new TextEncoder().encode(participant),
    auditorPublicKey: auditor.publicKey,
    price: 25_000_000_000n,
    proposal: {
      timelineDays: 14,
      approach: "manual review, fuzzing, and remediation report",
      metadata: { pilot: "the-signal", schema: "v1" },
    },
  });
  await client.submitV2({ roundId, sealed, escrow: 0n });
  console.log("sealed proposal committed with zero escrow");

  await waitUntil(revealAt);
  const signature = await fetchRoundSignature(drand, revealRound);
  await client.openRevealV2(roundId, signature);
  const storedSeal = await client.getSealV2(roundId, participant);
  if (!storedSeal) throw new Error("on-chain seal is missing");
  const envelope = await openPayload(storedSeal.ciphertext, drand);
  await client.revealV2({ roundId, bidder: participant, envelope });
  console.log("Drand gate opened and proposal revealed");

  await waitUntil(revealDeadline);
  await clearAfterLedgerCatchup(client, roundId);

  const [round, policy, submission, bidders] = await Promise.all([
    client.getRoundV2(roundId),
    client.getRoundPolicyV2(roundId),
    client.getSubmissionV2(roundId, participant),
    client.getBiddersV2(roundId),
  ]);
  if (round.mode.tag !== "ReceiptOnly" || round.status.tag !== "Settled") {
    throw new Error(`unexpected final round state: ${round.mode.tag}/${round.status.tag}`);
  }
  if (!submission.valid || !submission.settled || !submission.revealed_envelope) {
    throw new Error("proposal receipt did not persist a valid settled envelope");
  }
  if (bidders.length !== 1 || bidders[0] !== participant) {
    throw new Error("participant index does not match the committed proposal");
  }
  if (!policy || policy.fixed_escrow !== 0n || policy.eligible_participants[0] !== participant) {
    throw new Error("partner policy was not persisted correctly");
  }
  const receipt = await client.exportReceiptV2(roundId);
  const verification = verifyReceiptV2(receipt);
  if (!verification.valid) {
    throw new Error(`receipt verification failed: ${JSON.stringify(verification.issues)}`);
  }

  console.log("LIVE CORE V2 SMOKE PASSED");
  console.log(JSON.stringify({ contractId, roundId: roundId.toString(), mode: round.mode.tag, status: round.status.tag, participants: bidders.length, policy: receipt.policy, receiptVerified: true }));
}

main().catch((error) => {
  console.error("LIVE CORE V2 SMOKE FAILED");
  console.error(error);
  process.exitCode = 1;
});
