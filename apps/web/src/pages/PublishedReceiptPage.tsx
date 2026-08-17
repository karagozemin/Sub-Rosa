import {
  ArrowLeft,
  CheckCircle2,
  ExternalLink,
  FileCheck2,
  LoaderCircle,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  SubRosaClient,
  contractExplorerUrl,
  parsePublishedAuctionEvidence,
  transactionExplorerUrl,
  verifyPublishedAuctionEvidence,
  type PublishedAuctionEvidence,
} from "@sub-rosa/sdk";

interface PublishedReceiptPageProps {
  slug: string;
  goHome: () => void;
}

interface LedgerCheck {
  valid: boolean;
  message: string;
}

const TESTNET_NATIVE_XLM_SAC = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

const phaseLabels: Record<PublishedAuctionEvidence["transactions"][number]["phase"], string> = {
  create_round: "Create round",
  commit: "Sealed commit",
  open_reveal: "Open reveal",
  reveal: "Reveal",
  clear: "Clear winner",
  settle_and_refund: "Atomic settlement + refunds",
};

function short(value: string, edge = 8): string {
  return value.length <= edge * 2 + 3
    ? value
    : `${value.slice(0, edge)}...${value.slice(-edge)}`;
}

function amount(value: string): string {
  const units = BigInt(value);
  const whole = units / 10_000_000n;
  const fraction = (units % 10_000_000n).toString().padStart(7, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export function PublishedReceiptPage({ slug, goHome }: PublishedReceiptPageProps) {
  const [evidence, setEvidence] = useState<PublishedAuctionEvidence | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ledgerCheck, setLedgerCheck] = useState<LedgerCheck | null>(null);

  useEffect(() => {
    let active = true;
    setEvidence(null);
    setError(null);
    setLedgerCheck(null);

    fetch(`/instawards/receipts/${slug}.json`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Published receipt not found (${response.status})`);
        return parsePublishedAuctionEvidence(await response.text());
      })
      .then(async (record) => {
        if (!active) return;
        setEvidence(record);
        const client = new SubRosaClient({
          network: record.network,
          contractId: record.contractId,
        });
        try {
          const round = await client.getRoundV2(BigInt(record.roundId));
          const valid =
            round.status.tag === "Settled" &&
            round.mode.tag === "Auction" &&
            round.bidders.length === record.receipt.bidders.length &&
            round.winner === record.receipt.winner &&
            round.winning_bid.toString() === record.receipt.winningAmount;
          if (active) {
            setLedgerCheck({
              valid,
              message: valid
                ? "Live contract state matches the published receipt"
                : "Live contract state differs from the published receipt",
            });
          }
        } catch (cause) {
          if (active) {
            setLedgerCheck({
              valid: false,
              message: cause instanceof Error ? cause.message : String(cause),
            });
          }
        }
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : String(cause));
      });

    return () => {
      active = false;
    };
  }, [slug]);

  const verification = useMemo(
    () => evidence ? verifyPublishedAuctionEvidence(evidence, { minimumBidders: 3 }) : null,
    [evidence],
  );

  if (error) {
    return (
      <main className="published-receipt-page">
        <nav className="receipt-nav"><button type="button" onClick={goHome}><ArrowLeft size={17} />Sub Rosa</button></nav>
        <section className="receipt-message"><strong>Receipt unavailable</strong><p>{error}</p></section>
      </main>
    );
  }

  if (!evidence || !verification) {
    return (
      <main className="published-receipt-page">
        <nav className="receipt-nav"><button type="button" onClick={goHome}><ArrowLeft size={17} />Sub Rosa</button></nav>
        <section className="receipt-message"><LoaderCircle className="receipt-spinner" size={22} /><strong>Loading public receipt</strong></section>
      </main>
    );
  }

  const receipt = evidence.receipt;
  const contractUrl = contractExplorerUrl(evidence.network, evidence.contractId);
  const paymentUnit = evidence.network === "testnet" && receipt.paymentAsset === TESTNET_NATIVE_XLM_SAC
    ? "XLM"
    : "asset units";

  return (
    <main className="published-receipt-page">
      <nav className="receipt-nav">
        <button type="button" onClick={goHome}><ArrowLeft size={17} />Sub Rosa</button>
        <span>Instawards completion evidence · pre-SCF baseline</span>
      </nav>

      <header className="receipt-hero">
        <div>
          <span className="receipt-eyebrow">Public auction receipt</span>
          <h1>{evidence.title}</h1>
          <p>Canonical Core v2 round state paired with public Stellar transaction evidence.</p>
        </div>
        <div className={`receipt-verdict ${verification.valid ? "valid" : "invalid"}`}>
          {verification.valid ? <ShieldCheck size={22} /> : <FileCheck2 size={22} />}
          <div><span>Offline verification</span><strong>{verification.valid ? "VERIFIED" : "FAILED"}</strong></div>
        </div>
      </header>

      <section className="receipt-band receipt-summary">
        <div><span>Network</span><strong>{evidence.network === "testnet" ? "Stellar Testnet" : "Stellar Mainnet"}</strong></div>
        <div><span>Round</span><strong>#{evidence.roundId}</strong></div>
        <div><span>Status</span><strong>{receipt.status}</strong></div>
        <div><span>Bidders</span><strong>{receipt.bidders.length}</strong></div>
        <div><span>Winning bid</span><strong>{amount(receipt.winningAmount)} {paymentUnit}</strong></div>
        <div><span>Fixed escrow</span><strong>{amount(receipt.policy.fixedEscrow ?? "0")} {paymentUnit}</strong></div>
      </section>

      <section className="receipt-content">
        <div className="receipt-main-column">
          <section className="receipt-section">
            <div className="receipt-section-heading"><div><span>Settlement</span><h2>One atomic transaction</h2></div><CheckCircle2 size={20} /></div>
            <p>The winner payment, winner surplus refund, losing bidder refunds, and lot transfer execute in the same Core v2 settlement call.</p>
            <a className="receipt-primary-link" href={transactionExplorerUrl(evidence.network, evidence.settlement.transactionHash)} target="_blank" rel="noreferrer">
              <span><strong>Settlement + refund proof</strong><code>{short(evidence.settlement.transactionHash, 11)}</code></span><ExternalLink size={17} />
            </a>
            <ul className="receipt-effects">{evidence.settlement.effects.map((effect) => <li key={effect}>{effect}</li>)}</ul>
          </section>

          <section className="receipt-section">
            <div className="receipt-section-heading"><div><span>Participants</span><h2>Settled bidder records</h2></div><strong>{receipt.bidders.length}</strong></div>
            <div className="receipt-bidder-list">
              {receipt.bidders.map((bidder, index) => {
                const submission = receipt.submissions[bidder];
                const winner = bidder === receipt.winner;
                return (
                  <div key={bidder} className={winner ? "winner" : ""}>
                    <span>{winner ? "Winner" : `Bidder ${index + 1}`}</span>
                    <code title={bidder}>{short(bidder, 9)}</code>
                    <strong>{submission?.revealedAmount ? `${amount(submission.revealedAmount)} ${paymentUnit}` : "Not revealed"}</strong>
                    <small>{submission?.settled ? "Settled / refunded" : "Unsettled"}</small>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="receipt-section">
            <div className="receipt-section-heading"><div><span>Lifecycle</span><h2>Stellar transactions</h2></div><strong>{evidence.transactions.length}</strong></div>
            <div className="receipt-transaction-list">
              {evidence.transactions.map((transaction, index) => (
                <a key={`${transaction.phase}:${transaction.hash}:${index}`} href={transactionExplorerUrl(evidence.network, transaction.hash)} target="_blank" rel="noreferrer">
                  <span>{phaseLabels[transaction.phase]}</span><code>{short(transaction.hash, 10)}</code><ExternalLink size={15} />
                </a>
              ))}
            </div>
          </section>
        </div>

        <aside className="receipt-sidebar">
          <section>
            <span>Live ledger check</span>
            <strong className={ledgerCheck?.valid ? "ok" : ledgerCheck ? "bad" : "pending"}>
              {ledgerCheck ? ledgerCheck.valid ? "MATCHED" : "UNCONFIRMED" : "CHECKING"}
            </strong>
            <p>{ledgerCheck?.message ?? "Reading canonical round state from Stellar RPC."}</p>
          </section>
          <section>
            <span>Contract</span>
            <code title={evidence.contractId}>{short(evidence.contractId, 10)}</code>
            <a href={contractUrl} target="_blank" rel="noreferrer">Open contract <ExternalLink size={14} /></a>
          </section>
          <section>
            <span>Reveal boundary</span>
            <strong>Drand #{receipt.revealRound}</strong>
            <p>Offers remained commitment-bound until the configured Drand round.</p>
          </section>
          {!verification.valid && <section className="receipt-issues"><span>Verification issues</span>{verification.issues.map((issue) => <p key={`${issue.code}:${issue.message}`}>{issue.code}: {issue.message}</p>)}</section>}
        </aside>
      </section>
    </main>
  );
}
