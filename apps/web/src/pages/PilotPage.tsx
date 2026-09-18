import { drandRoundTime } from "@sub-rosa/tlock";
import { Buffer } from "buffer";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  getNetworkDetails,
  isConnected,
  requestAccess,
} from "@stellar/freighter-api";
import {
  ASSET_AUCTION_SCHEMA_REF,
  SEALED_PROPOSAL_SCHEMA_REF,
  serializeReceiptV2,
  sealAssetBid,
  sealProposal,
  type RoundV2,
  type RoundPolicyV2,
  type RevealStateV3,
  verifyReceiptV2,
} from "@sub-rosa/sdk";
import {
  fetchRoundSignature,
  encodePayloadEnvelope,
  generateAuditorKeypair,
  openPayload,
  quicknet,
  roundInSeconds,
} from "@sub-rosa/tlock";

import {
  CONTRACT_ID,
  NETWORK,
  displayError,
  freighterError,
  resolveFreighterAddress,
  sha256Bytes,
  useReadOnlyContract,
  useReadOnlySdk,
  useWalletContract,
} from "../lib/chain";
import { LOGO_SRC } from "../lib/chain";
import { pilotRoundIdFromHash } from "../config/routing";
import { useDrandCountdown } from "../hooks/useDrandCountdown";
import { useToast } from "../ui/Toast";
import { ConfettiBurst } from "../ui/Confetti";
import { pilotRevealAction } from "../lib/pilotReveal";
import {
  isRevealAlreadyOpen,
  isSubmissionAlreadyRevealed,
} from "../lib/pilotConcurrency";
import {
  decodePilotSubmission,
  type PilotSubmissionView,
} from "../lib/pilotSubmission";

type PilotTemplate = "proposal" | "auction";

function statusTone(status: RoundV2["status"]["tag"]) {
  if (status === "Settled") return "settled";
  if (status === "Voided") return "voided";
  if (status === "Cleared") return "cleared";
  if (status === "Revealing") return "revealing";
  return "open";
}

function shortAddress(value: string | undefined) {
  if (!value) return "None";
  return `${value.slice(0, 7)}...${value.slice(-7)}`;
}

export function PilotPage({ goHome }: { goHome: () => void }) {
  const toast = useToast();
  const [address, setAddress] = useState<string | null>(null);
  const [template, setTemplate] = useState<PilotTemplate>("proposal");
  const [requestTitle, setRequestTitle] = useState("Soroban security audit");
  const [openingMode, setOpeningMode] = useState<"timed" | "owner-triggered">("timed");
  const [ownerMinutes, setOwnerMinutes] = useState("5");
  const [supportsOwnerOpening, setSupportsOwnerOpening] = useState(false);
  const [revealState, setRevealState] = useState<RevealStateV3 | null>(null);
  const [commitMinutes, setCommitMinutes] = useState("5");
  const [paymentAsset, setPaymentAsset] = useState("");
  const [lotAsset, setLotAsset] = useState("");
  const [lotAmount, setLotAmount] = useState("1");
  const [roundId, setRoundId] = useState(pilotRoundIdFromHash);
  const [round, setRound] = useState<RoundV2 | null>(null);
  const [roundPolicy, setRoundPolicy] = useState<RoundPolicyV2 | null>(null);
  const [revealedSubmissions, setRevealedSubmissions] = useState<PilotSubmissionView[]>([]);
  const [price, setPrice] = useState("25000000000");
  const [escrow, setEscrow] = useState("25000000000");
  const [eligibleParticipants, setEligibleParticipants] = useState("");
  const [timelineDays, setTimelineDays] = useState("14");
  const [approach, setApproach] = useState("Manual review, fuzzing, and remediation report");
  const [busy, setBusy] = useState<string | null>(null);
  const [confettiTick, setConfettiTick] = useState(0);
  const previousComplete = useRef<boolean | null>(null);
  const refreshRequest = useRef(0);
  const contract = useWalletContract(address);
  const reader = useReadOnlyContract();
  const sdk = useReadOnlySdk();
  const revealCountdown = useDrandCountdown(
    round ? Number(round.reveal_round) : 0,
  );
  const ownerOpening = round && revealState?.policy.tag === "OwnerTriggered" ? {
    controller: round.operator, caller: address, fallbackAt: Number(revealState.policy.values[0]),
    now: Math.floor(Date.now() / 1000), revealDeadline: Number(round.reveal_deadline),
  } : undefined;
  const revealAction = pilotRevealAction(
    round?.status.tag ?? "Unknown",
    revealCountdown.published,
    revealCountdown.secondsRemaining,
    Boolean(
      round &&
      round.bidders.length > 0 &&
      revealedSubmissions.length === round.bidders.length,
    ),
    ownerOpening,
  );
  const submissionIsAuction = round
    ? round.mode.tag === "Auction"
    : template === "auction";

  const pilotComplete = round?.status.tag === "Settled";

  useEffect(() => {
    if (previousComplete.current === false && pilotComplete) {
      window.scrollTo({ top: 0, behavior: "smooth" });
      setConfettiTick((current) => current + 1);
    }
    previousComplete.current = pilotComplete;
  }, [pilotComplete]);

  const shareUrl = useMemo(() => {
    if (!roundId) return "";
    return `${window.location.origin}${window.location.pathname}#/pilot/${roundId}`;
  }, [roundId]);

  useEffect(() => {
    let active = true;
    setSupportsOwnerOpening(false);
    if (sdk) void sdk.supportsRevealPolicy().then((supported) => {
      if (active) setSupportsOwnerOpening(supported);
    }).catch(() => { /* Keep owner opening disabled until the capability is confirmed. */ });
    return () => { active = false; };
  }, [sdk]);

  async function connect() {
    setBusy("connect");
    try {
      const connected = await isConnected();
      if (!connected.isConnected) throw new Error("Freighter is not available");
      const access = await requestAccess();
      const error = freighterError(access);
      if (error) throw new Error(error);
      const nextAddress = await resolveFreighterAddress(access);
      const network = await getNetworkDetails();
      if (network.networkPassphrase !== NETWORK) {
        throw new Error(`Switch Freighter to the configured network (${network.network})`);
      }
      setAddress(nextAddress);
      toast.push("success", "Wallet connected", shortAddress(nextAddress));
    } catch (error) {
      toast.push("error", "Wallet connection failed", displayError(error));
    } finally {
      setBusy(null);
    }
  }

  async function refresh(target = roundId) {
    if (!reader || !target) return;
    const request = ++refreshRequest.current;
    const rid = BigInt(target);
    const [tx, policyTx] = await Promise.all([
      reader.get_round_v2({ round_id: rid }),
      reader.get_round_policy_v2({ round_id: rid }),
    ]);
    const nextRound = tx.result.unwrap();
    const nextPolicy = policyTx.result ?? null;
    if (nextRound.protocol_version !== 2 && nextRound.protocol_version !== 3) throw new Error("Unsupported round version");
    const nextReveal = nextRound.protocol_version === 3
      ? (await reader.get_reveal_state_v3({ round_id: rid })).result.unwrap() : null;

    const revealed = await Promise.all(
      nextRound.bidders.map(async (bidder) => {
        const submission = (
          await reader.get_submission_v2({ round_id: BigInt(target), bidder })
        ).result.unwrap();
        if (submission.revealed_envelope == null) return null;
        return decodePilotSubmission(
          bidder,
          nextRound.mode.tag,
          new Uint8Array(submission.revealed_envelope),
          submission.valid,
        );
      }),
    );
    if (request !== refreshRequest.current) return;

    setRound(nextRound);
    setRoundPolicy(nextPolicy);
    setRevealState(nextReveal);
    if (nextPolicy && nextRound.mode.tag === "Auction") {
      setEscrow(nextPolicy.fixed_escrow.toString());
    }
    setTemplate(nextRound.mode.tag === "Auction" ? "auction" : "proposal");
    setRevealedSubmissions(
      revealed.filter((entry): entry is PilotSubmissionView => entry !== null),
    );
  }

  useEffect(() => {
    const onHashChange = () => {
      const nextRoundId = pilotRoundIdFromHash();
      refreshRequest.current += 1;
      setRoundId(nextRoundId);
      setRound(null);
      setRoundPolicy(null);
      setRevealState(null);
      setRevealedSubmissions([]);
      if (reader && nextRoundId) {
        void refresh(nextRoundId).catch((error) =>
          toast.push("error", "Round load failed", displayError(error)),
        );
      }
    };

    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [reader]);

  useEffect(() => {
    if (reader && roundId) {
      void refresh(roundId).catch((error) =>
        toast.push("error", "Round load failed", displayError(error)),
      );
    }
  }, [reader]);

  async function createRound() {
    if (!contract || !address) return;
    setBusy("create");
    try {
      if (!requestTitle.trim()) throw new Error("Enter a request or lot name");
      if (template === "auction" && (!paymentAsset.trim() || !lotAsset.trim())) {
        throw new Error("Payment SAC and lot SAC are required for an asset auction");
      }
      const drand = quicknet();
      const commitSeconds = Math.max(60, Number(commitMinutes) * 60);
      const revealRound = await roundInSeconds(drand, commitSeconds + 15);
      const info = await drand.chain().info();
      const revealAt = drandRoundTime(revealRound, info);
      const auditor = generateAuditorKeypair();
      const itemRef = await sha256Bytes(`${requestTitle}:${address}:${Date.now()}`);
      const isAuction = template === "auction";
      const allowlist = eligibleParticipants
        .split(/[\s,]+/)
        .map((entry) => entry.trim())
        .filter(Boolean);
      if (new Set(allowlist).size !== allowlist.length) {
        throw new Error("Participant allowlist contains duplicate addresses");
      }
      if (allowlist.length > 25) {
        throw new Error("Participant allowlist cannot exceed 25 addresses");
      }
      const fixedEscrow = isAuction ? BigInt(escrow) : 0n;
      if (isAuction && fixedEscrow <= 0n) {
        throw new Error("Fixed escrow must be positive for an asset auction");
      }
      if (openingMode === "owner-triggered" && !supportsOwnerOpening) throw new Error("Owner opening is unavailable on this deployment");
      const fallbackAt = revealAt + Number(ownerMinutes) * 60;
      const args: Parameters<typeof contract.create_partner_round_v2>[0] = {
        operator: address,
        item_ref: Buffer.from(itemRef),
        schema_ref: Buffer.from(
          isAuction ? ASSET_AUCTION_SCHEMA_REF : SEALED_PROPOSAL_SCHEMA_REF,
        ),
        policy: {
          settlement: {
            mode: { tag: isAuction ? "Auction" : "ReceiptOnly", values: undefined },
            payment_asset: isAuction ? paymentAsset.trim() : undefined,
            lot_asset: isAuction ? lotAsset.trim() : undefined,
            lot_amount: isAuction ? BigInt(lotAmount) : 0n,
          },
          fixed_escrow: fixedEscrow,
          eligible_participants: allowlist,
        },
        reveal_round: BigInt(revealRound),
        clearing_rule: {
          tag: isAuction ? "HighestBid" : "LowestBid",
          values: undefined,
        },
        commit_deadline: BigInt(revealAt - 10),
        reveal_deadline: BigInt((openingMode === "owner-triggered" ? fallbackAt : revealAt) + 300),
        auditor_pubkey: Buffer.from(auditor.publicKey),
        max_participants: 25,
      };
      const tx = openingMode === "owner-triggered"
        ? await contract.create_round_v3({ ...args, policy: { partner: args.policy, reveal: { tag: "OwnerTriggered", values: [BigInt(fallbackAt)] } } })
        : await contract.create_partner_round_v2(args);
      const sent = await tx.signAndSend();
      const nextId = sent.result.unwrap().toString();
      setRoundId(nextId);
      window.location.hash = `#/pilot/${nextId}`;
      await refresh(nextId);
      toast.push("success", "Pilot round created", `Round #${nextId}`);
    } catch (error) {
      toast.push("error", "Round creation failed", displayError(error));
    } finally {
      setBusy(null);
    }
  }

  async function loadRound() {
    setBusy("load");
    try {
      if (!/^\d+$/.test(roundId)) throw new Error("Round ID must be a whole number");
      await refresh();
      if (roundId) window.location.hash = `#/pilot/${roundId}`;
    } catch (error) {
      toast.push("error", "Round load failed", displayError(error));
    } finally {
      setBusy(null);
    }
  }

  async function submit() {
    if (!contract || !address || !round || !roundId) return;
    setBusy("submit");
    try {
      const amount = BigInt(price);
      const drand = quicknet();
      const identity = new TextEncoder().encode(address);
      const common = {
        round: Number(round.reveal_round),
        drand,
        identity,
        auditorPublicKey: new Uint8Array(round.auditor_pubkey),
      };
      const sealed =
        round.mode.tag === "Auction"
          ? await sealAssetBid({ ...common, amount })
          : await sealProposal({
              ...common,
              price: amount,
              proposal: {
                timelineDays: Number(timelineDays),
                approach,
              },
            });
      const tx = await contract.commit_v2({
        round_id: BigInt(roundId),
        bidder: address,
        commitment: Buffer.from(sealed.commitment),
        ciphertext: Buffer.from(sealed.ciphertext),
        escrow: round.mode.tag === "Auction"
          ? roundPolicy?.fixed_escrow ?? BigInt(escrow)
          : 0n,
        auditor_blob: Buffer.from(sealed.auditorBlob),
      });
      await tx.signAndSend();
      await refresh();
      toast.push("success", "Submission sealed", `Round #${roundId}`);
    } catch (error) {
      toast.push("error", "Submission failed", displayError(error));
    } finally {
      setBusy(null);
    }
  }

  async function revealAll() {
    if (!contract || !round || !roundId) return;
    if (!revealAction.ready) return;
    setBusy("reveal");
    try {
      const rid = BigInt(roundId);
      const drand = quicknet();
      let current = (
        await contract.get_round_v2({ round_id: rid })
      ).result.unwrap();
      if (current.status.tag !== "Open" && current.status.tag !== "Revealing") {
        await refresh();
        toast.push(
          "info",
          "Reveal phase complete",
          `Round is already ${current.status.tag.toLowerCase()}.`,
        );
        return;
      }
      let revealWasAlreadyOpen = current.status.tag !== "Open";
      if (current.status.tag === "Open") {
        const signature = await fetchRoundSignature(drand, Number(current.reveal_round));
        try {
          const open = await contract.open_reveal_v2({
            round_id: rid,
            drand_signature: Buffer.from(signature),
          });
          await open.signAndSend();
        } catch (error) {
          if (!isRevealAlreadyOpen(error)) throw error;
          revealWasAlreadyOpen = true;
        }
        current = (await contract.get_round_v2({ round_id: rid })).result.unwrap();
        if (current.status.tag === "Open") {
          throw new Error("Reveal state has not propagated yet. Refresh and retry.");
        }
      }
      const bidders = (await contract.get_bidders_v2({ round_id: rid })).result.unwrap();
      let revealedCount = 0;
      let alreadyRevealedCount = 0;
      for (const bidder of bidders) {
        const state = (
          await contract.get_submission_v2({ round_id: rid, bidder })
        ).result.unwrap();
        if (state.revealed_envelope != null) {
          alreadyRevealedCount += 1;
          continue;
        }
        const seal = (await contract.get_seal_v2({ round_id: rid, bidder })).result;
        if (!seal) throw new Error(`Encrypted submission is unavailable for ${shortAddress(bidder)}`);
        const envelope = await openPayload(new Uint8Array(seal.ciphertext), drand);
        try {
          const reveal = await contract.reveal_v2({
            round_id: rid,
            bidder,
            envelope: Buffer.from(encodePayloadEnvelope(envelope)),
          });
          await reveal.signAndSend();
          revealedCount += 1;
        } catch (error) {
          if (!isSubmissionAlreadyRevealed(error)) throw error;
          alreadyRevealedCount += 1;
        }
      }
      await refresh();
      if (revealedCount > 0) {
        toast.push("success", "Decryption complete", `${revealedCount} submission(s) revealed`);
      } else {
        toast.push(
          "info",
          revealWasAlreadyOpen ? "Reveal already opened" : "Nothing new to reveal",
          alreadyRevealedCount === bidders.length
            ? "All submissions are already public."
            : "Round state was refreshed.",
        );
      }
    } catch (error) {
      toast.push("error", "Reveal failed", displayError(error));
    } finally {
      setBusy(null);
    }
  }

  async function clearRound() {
    if (!contract || !roundId) return;
    setBusy("clear");
    try {
      const tx = await contract.clear_v2({ round_id: BigInt(roundId) });
      await tx.signAndSend();
      await refresh();
      toast.push("success", "Round cleared", `Round #${roundId}`);
    } catch (error) {
      toast.push("error", "Clear failed", displayError(error));
    } finally {
      setBusy(null);
    }
  }

  async function settleRound() {
    if (!contract || !roundId) return;
    setBusy("settle");
    try {
      const tx = await contract.settle_v2({ round_id: BigInt(roundId) });
      await tx.signAndSend();
      await refresh();
      toast.push("success", "Auction settled", `Round #${roundId}`);
    } catch (error) {
      toast.push("error", "Settlement failed", displayError(error));
    } finally {
      setBusy(null);
    }
  }

  async function voidRound() {
    if (!contract || !roundId) return;
    setBusy("void");
    try {
      const tx = await contract.void_v2({ round_id: BigInt(roundId) });
      await tx.signAndSend();
      await refresh();
      toast.push("success", "Round voided", "Escrow and auction lot returned");
    } catch (error) {
      toast.push("error", "Refund failed", displayError(error));
    } finally { setBusy(null); }
  }

  async function copyLink() {
    if (!shareUrl) return;
    await navigator.clipboard.writeText(shareUrl);
    toast.push("success", "Pilot link copied", `Round #${roundId}`);
  }

  async function downloadReceipt() {
    if (!sdk || !roundId || !round) return;
    setBusy("receipt");
    try {
      const receipt = await sdk.exportReceiptV2(BigInt(roundId));
      const verification = verifyReceiptV2(receipt);
      if (!verification.valid) {
        throw new Error(
          `Receipt verification failed: ${verification.issues
            .filter((issue) => issue.severity === "error")
            .map((issue) => issue.code)
            .join(", ")}`,
        );
      }
      const blob = new Blob([serializeReceiptV2(receipt)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `sub-rosa-round-${roundId}-v${receipt.version}-receipt.json`;
      link.click();
      URL.revokeObjectURL(url);
      toast.push("success", "Receipt verified", `Round #${roundId} downloaded`);
    } catch (error) {
      toast.push("error", "Receipt export failed", displayError(error));
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="pilot-page">
      <ConfettiBurst fire={confettiTick} count={48} />
      <nav className="pilot-nav">
        <button type="button" className="brand-link" onClick={goHome}>
          <img src={LOGO_SRC} alt="" />
          <span>Sub Rosa</span>
        </button>
        <div className="pilot-nav-actions">
          <a href="#/docs" target="_blank" rel="noreferrer" className="secondary-action compact">Docs</a>
          <button
            type="button"
            className="secondary-action compact"
            onClick={connect}
            disabled={busy !== null}
          >
            {address ? shortAddress(address) : busy === "connect" ? "Connecting..." : "Connect wallet"}
          </button>
        </div>
      </nav>

      <header className="pilot-header">
        <div>
          <span className="pilot-kicker">Partner pilot workspace</span>
          <h1>Sealed round operations</h1>
        </div>
        <div className="pilot-template-switch" aria-label="Round template">
          <button
            type="button"
            className={template === "proposal" ? "active" : ""}
            onClick={() => setTemplate("proposal")}
          >
            Sealed proposal
          </button>
          <button
            type="button"
            className={template === "auction" ? "active" : ""}
            onClick={() => setTemplate("auction")}
          >
            Asset auction
          </button>
        </div>
      </header>

      {!CONTRACT_ID && (
        <div className="pilot-alert">VITE_CONTRACT_ID is not configured.</div>
      )}

      <div className="pilot-layout">
        <section className="pilot-panel">
          <div className="pilot-panel-heading">
            <span>Organizer</span>
            <strong>New round</strong>
          </div>
          <div className="pilot-form">
            <label>
              Request or lot name
              <input value={requestTitle} onChange={(event) => setRequestTitle(event.target.value)} />
            </label>
            <label>
              Commit window
              <select value={commitMinutes} onChange={(event) => setCommitMinutes(event.target.value)}>
                <option value="2">2 minutes</option>
                <option value="5">5 minutes</option>
                <option value="15">15 minutes</option>
                <option value="60">1 hour</option>
              </select>
            </label>
            <label>
              Reveal opening
              <select value={openingMode} onChange={(event) => setOpeningMode(event.target.value as "timed" | "owner-triggered")}>
                <option value="timed">Timed — anyone can open after Drand</option>
                <option value="owner-triggered" disabled={!supportsOwnerOpening}>Owner-triggered{!supportsOwnerOpening ? " — unavailable on this deployment" : ""}</option>
              </select>
            </label>
            {openingMode === "owner-triggered" && <>
              <label>
                Owner opening window after Drand
                <select value={ownerMinutes} onChange={(event) => setOwnerMinutes(event.target.value)}>
                  <option value="5">5 minutes</option>
                  <option value="15">15 minutes</option>
                  <option value="60">1 hour</option>
                </select>
              </label>
              <p>Only your wallet can open during this window. Afterwards anyone can open, with 5 more minutes to reveal submissions. Drand publication makes submissions decryptable even if you have not opened the round.</p>
            </>}
            {template === "auction" && (
              <>
                <label>
                  Payment SAC
                  <input value={paymentAsset} onChange={(event) => setPaymentAsset(event.target.value)} />
                </label>
                <label>
                  Lot SAC
                  <input value={lotAsset} onChange={(event) => setLotAsset(event.target.value)} />
                </label>
                <label>
                  Lot amount
                  <input inputMode="numeric" value={lotAmount} onChange={(event) => setLotAmount(event.target.value)} />
                </label>
                <label>
                  Fixed escrow per bidder
                  <input inputMode="numeric" value={escrow} onChange={(event) => setEscrow(event.target.value)} />
                </label>
              </>
            )}
            <label>
              Eligible participants (optional)
              <textarea
                value={eligibleParticipants}
                onChange={(event) => setEligibleParticipants(event.target.value)}
                rows={3}
                placeholder="One Stellar address per line"
              />
            </label>
            <button
              type="button"
              className="primary-action"
              disabled={!address || busy !== null}
              onClick={createRound}
            >
              {busy === "create" ? "Creating..." : "Create round"}
            </button>
          </div>
        </section>

        <section className="pilot-panel pilot-participant-panel">
          <div className="pilot-panel-heading">
            <span>Participant</span>
            <strong>Sealed submission</strong>
          </div>
          <div className="pilot-round-loader">
            <input
              aria-label="Round id"
              inputMode="numeric"
              placeholder="Round ID"
              value={roundId}
              onChange={(event) => setRoundId(event.target.value)}
            />
            <button type="button" className="secondary-action compact" onClick={loadRound} disabled={!reader || !roundId}>
              Load
            </button>
          </div>
          <div className="pilot-form">
            <label>
              Private price / bid
              <input inputMode="numeric" value={price} onChange={(event) => setPrice(event.target.value)} />
            </label>
            {!submissionIsAuction && (
              <>
                <label>
                  Timeline (days)
                  <input inputMode="numeric" value={timelineDays} onChange={(event) => setTimelineDays(event.target.value)} />
                </label>
                <label>
                  Approach
                  <textarea value={approach} onChange={(event) => setApproach(event.target.value)} rows={4} />
                </label>
              </>
            )}
            {submissionIsAuction && (
              <label>
                Enforced escrow
                <input
                  inputMode="numeric"
                  value={roundPolicy?.fixed_escrow.toString() ?? escrow}
                  onChange={(event) => setEscrow(event.target.value)}
                  readOnly={roundPolicy !== null}
                />
              </label>
            )}
            <button
              type="button"
              className="primary-action"
              disabled={!address || !round || round.status.tag !== "Open" || busy !== null}
              onClick={submit}
            >
              {busy === "submit" ? "Sealing..." : "Seal submission"}
            </button>
          </div>
        </section>

        <section className="pilot-panel pilot-status-panel">
          <div className="pilot-panel-heading">
            <span>Lifecycle</span>
            <strong>Round status</strong>
          </div>
          {round ? (
            <>
              <div className="pilot-status-topline">
                <span className={`pilot-status ${statusTone(round.status.tag)}`}>{round.status.tag}</span>
                <code>#{roundId}</code>
              </div>
              <dl className="pilot-facts">
                <div><dt>Mode</dt><dd>{round.mode.tag}</dd></div>
                <div><dt>Participants</dt><dd>{round.bidders.length} / {round.max_participants}</dd></div>
                <div><dt>Eligibility</dt><dd>{roundPolicy?.eligible_participants.length ? `${roundPolicy.eligible_participants.length} allowlisted` : "Open"}</dd></div>
                {round.mode.tag === "Auction" && (
                  <div><dt>Fixed escrow</dt><dd>{roundPolicy?.fixed_escrow.toString() ?? "Legacy variable cap"}</dd></div>
                )}
                <div><dt>Opening</dt><dd>{ownerOpening ? "Owner-triggered" : "Timed"}</dd></div>
                {ownerOpening && <>
                  <div><dt>Controller</dt><dd>{shortAddress(ownerOpening.controller)}</dd></div>
                  <div><dt>Public fallback</dt><dd>{new Date(ownerOpening.fallbackAt * 1000).toLocaleString()}</dd></div>
                </>}
                <div><dt>Reveal deadline</dt><dd>{new Date(Number(round.reveal_deadline) * 1000).toLocaleString()}</dd></div>
                <div><dt>Drand round</dt><dd>{round.reveal_round.toString()}</dd></div>
                <div><dt>Winner</dt><dd>{shortAddress(round.winner)}</dd></div>
                <div><dt>Payment asset</dt><dd>{shortAddress(round.payment_asset)}</dd></div>
                <div><dt>Lot asset</dt><dd>{shortAddress(round.lot_asset)}</dd></div>
                {round.mode.tag === "Auction" && (
                  <>
                    <div><dt>Winning amount</dt><dd>{round.winning_bid.toString()}</dd></div>
                    <div><dt>Lot amount</dt><dd>{round.lot_amount.toString()}</dd></div>
                  </>
                )}
              </dl>
              {ownerOpening && <p>Opening controls the on-chain phase. Once Drand publishes, anyone with the ciphertext can decrypt it off-chain.</p>}
              <div className="pilot-actions">
                {round.status.tag === "Open" && Date.now() / 1000 > Number(round.reveal_deadline) + 3600 && (
                  <button type="button" className="secondary-action compact" disabled={!address || busy !== null} onClick={voidRound}>Void and refund</button>
                )}
                <button type="button" className="secondary-action compact" onClick={copyLink}>Copy link</button>
                <button type="button" className="secondary-action compact" onClick={() => refresh()}>Refresh</button>
                {(round.status.tag === "Settled" || round.status.tag === "Voided") && (
                  <button
                    type="button"
                    className="secondary-action compact"
                    onClick={downloadReceipt}
                    disabled={!sdk || busy !== null}
                  >
                    {busy === "receipt" ? "Verifying..." : "Download receipt"}
                  </button>
                )}
                {revealAction.visible && (
                  <button
                    type="button"
                    className="secondary-action compact"
                    onClick={revealAll}
                    disabled={!address || busy !== null || !revealAction.ready}
                  >
                    {revealAction.label}
                  </button>
                )}
                {round.status.tag === "Revealing" && (
                  <button type="button" className="secondary-action compact" onClick={clearRound} disabled={!address || busy !== null}>Clear</button>
                )}
                {round.status.tag === "Cleared" && round.mode.tag === "Auction" && (
                  <button type="button" className="primary-action compact" onClick={settleRound} disabled={!address || busy !== null}>Settle</button>
                )}
              </div>
            </>
          ) : (
            <div className="pilot-empty">No round loaded</div>
          )}
        </section>

        {round && (
          <section className="pilot-panel pilot-results-panel">
            <div className="pilot-panel-heading">
              <span>Public after Drand reveal</span>
              <strong>Decrypted submissions</strong>
            </div>
            {revealedSubmissions.length > 0 ? (
              <div className="pilot-results">
                {revealedSubmissions.map((submission) => (
                  <article className="pilot-result" key={submission.bidder}>
                    <div className="pilot-result-heading">
                      <code>{shortAddress(submission.bidder)}</code>
                      <span className={submission.valid ? "valid" : "invalid"}>
                        {submission.valid ? "Verified" : "Invalid"}
                      </span>
                    </div>
                    <dl>
                      <div><dt>Private price / bid</dt><dd>{submission.amount ?? "None"}</dd></div>
                      {submission.timelineDays != null && (
                        <div><dt>Timeline</dt><dd>{submission.timelineDays} day(s)</dd></div>
                      )}
                      {submission.approach && (
                        <div><dt>Approach</dt><dd>{submission.approach}</dd></div>
                      )}
                      {submission.payload && (
                        <div><dt>Payload</dt><dd>{submission.payload}</dd></div>
                      )}
                    </dl>
                  </article>
                ))}
              </div>
            ) : (
              <div className="pilot-empty">
                {round.status.tag === "Open"
                  ? (revealCountdown.published ? "Drand time has passed. Submissions can be decrypted off-chain; on-chain reveal is pending." : "Submissions remain encrypted until Drand publishes the reveal round.")
                  : "No decrypted submissions yet."}
              </div>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
