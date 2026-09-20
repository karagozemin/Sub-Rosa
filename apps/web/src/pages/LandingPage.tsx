import { motion, useReducedMotion } from "framer-motion";
import { DEMO_TRACE } from "../demo/trace";
import { USE_CASES, type UseCaseId } from "../config/useCases";
import { LOGO_SRC } from "../config/brand";
import { shortAddr } from "../lib/format";

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0 },
};

const staggerParent = {
  hidden: {},
  show: {
    transition: {
      staggerChildren: 0.08,
      delayChildren: 0.12,
    },
  },
};

interface PilotPartner {
  id: "stelhacks" | "offer-hub" | "octarine";
  name: string;
  status: string;
  meta: string;
  description: string;
  logo: string;
  href?: string;
}

const PILOT_PARTNERS: PilotPartner[] = [
  {
    id: "stelhacks",
    name: "StelHacks",
    status: "Real integration",
    meta: "Hackathon judging",
    description:
      "Jury scorecards and community ballots stay time-lock encrypted until judging closes, then reveal together with verifiable evidence.",
    logo: "/pilots/stelhacks/stelhacks-logo.png",
    href: "https://github.com/emirykl/StelHacks/blob/main/frontend/lib/sealed-input.ts#L1-L49",
  },
  {
    id: "offer-hub",
    name: "OFFER HUB",
    status: "Real integration",
    meta: "Freelancer proposals",
    description:
      "Price, timeline, and approach stay sealed until the shared deadline, then every proposal reveals together for client selection.",
    logo: "/pilots/offer-hub/offer-hub.jpg",
    href: "https://github.com/karagozemin/OFFER-HUB-Frontend/blob/feat/sub-rosa-sealed-proposals/src/features/sub-rosa/live/operations.ts#L64-L174",
  },
  {
    id: "octarine",
    name: "Octarine",
    status: "Real Integration Process",
    meta: "SCF #44 · RWA liquidity",
    description:
      "A planned sealed RFQ layer for RWA liquidity, keeping LP quotes private until the deadline before revealing them together for price selection.",
    logo: "/pilots/octarine/octarine-logo.svg",
  },
];

function PartnerCardContent({ partner }: { partner: PilotPartner }) {
  return (
    <>
      <div className={`landing-partner-logo ${partner.id}`}>
        <img src={partner.logo} alt={`${partner.name} logo`} />
      </div>
      <div className="landing-partner-card-body">
        <div className="landing-partner-card-topline">
          <span className={partner.href ? "real" : "planned"}>{partner.status}</span>
          <small>{partner.meta}</small>
        </div>
        <h3>{partner.name}</h3>
        <p>{partner.description}</p>
        <span className={`landing-partner-card-cta ${partner.href ? "" : "static"}`}>
          {partner.href ? "View integration" : "Partner workflow in design"}
          {partner.href ? <span aria-hidden="true">↗</span> : null}
        </span>
      </div>
    </>
  );
}

export function LandingPage({
  onDemo,
  onCase,
}: {
  onDemo: () => void;
  onCase: (useCase: UseCaseId) => void;
}) {
  const reduce = useReducedMotion();

  const transition = reduce
    ? { duration: 0 }
    : { duration: 0.7, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] };

  return (
    <main className="landing-page">
      <motion.nav
        className="landing-nav"
        initial={{ opacity: 0, y: -16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      >
        <button type="button" className="brand-link" onClick={onDemo}>
          <img src={LOGO_SRC} alt="" />
          <span>Sub Rosa</span>
        </button>
        <div className="landing-nav-actions">
          <span className="landing-status-pill winner">Hack Privacy #1</span>
          <a href="https://github.com/karagozemin/Sub-Rosa" target="_blank" rel="noreferrer">
            GitHub
          </a>
          <a href="#/docs" target="_blank" rel="noreferrer">Docs</a>
          <a href="#/dashboard" className="secondary-action compact">
            Dashboard
          </a>
          <a href="#/pilot" className="primary-action compact">
            Pilot workspace
          </a>
        </div>
      </motion.nav>

      <motion.section
        className="landing-hero"
        variants={staggerParent}
        initial="hidden"
        animate="show"
      >
        <motion.div className="hero-copy" variants={fadeUp} transition={transition}>
          <span className="hero-eyebrow">
            <span>SR</span>
            Sealed auction settlement on Stellar
          </span>
          <motion.h1 variants={fadeUp} transition={transition}>
            Sealed auctions. <em>Settled on Stellar.</em>
          </motion.h1>
          <motion.p className="lede" variants={fadeUp} transition={transition}>
            Bidders lock escrow, bids stay unreadable until Drand R, and Soroban settles the
            winner while refunding losers.
          </motion.p>
          <motion.p className="hero-infra-line" variants={fadeUp} transition={transition}>
            Built as an embeddable Soroban contract, TypeScript SDK, tlock package, and
            permissionless keeper.
          </motion.p>

          <motion.div className="hero-actions" variants={fadeUp} transition={transition}>
            <button type="button" className="primary-action large" onClick={onDemo}>
              Open sealed auction demo
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M5 12h14M13 6l6 6-6 6"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            <a className="secondary-action" href="#/architecture">
              Read the architecture
            </a>
            <a className="secondary-action" href="#/docs" target="_blank" rel="noreferrer">
              Integration docs
            </a>
          </motion.div>

          <motion.div
            className="hero-metrics"
            aria-label="Proof points"
            variants={fadeUp}
            transition={transition}
          >
            <div>
              <span>Drand gate</span>
              <strong>R {DEMO_TRACE.meta.revealRound.toLocaleString()}</strong>
            </div>
            <div>
              <span>Settlement</span>
              <strong>{DEMO_TRACE.keeper.contractBalanceFinal} USDC final</strong>
            </div>
            <div>
              <span>Next milestone</span>
              <strong>Named pilot</strong>
            </div>
          </motion.div>
        </motion.div>

        <motion.div
          className="hero-console"
          variants={fadeUp}
          transition={{ ...transition, delay: 0.18 }}
          aria-hidden="true"
        >
          <div className="console-status-row">
            <div>
              <span>auction round</span>
              <strong>Bids sealed</strong>
            </div>
            <span className="status-tag">commit live</span>
          </div>

          <div className="seal-stage">
            <span className="seal-pulse" />
            <span className="seal-pulse" />
            <span className="seal-pulse" />
            <div className="seal-orb">
              <img src={LOGO_SRC} alt="" />
            </div>
            <span className="seal-chip commit">
              <i />
              commit · H
            </span>
            <span className="seal-chip cipher">
              <i />
              ciphertext
            </span>
            <span className="seal-chip drand">
              <i />
              Drand R
            </span>
          </div>

          <div className="console-events">
            <p>
              <strong>1</strong>
              <span>Bidders lock escrow + sealed bids</span>
              <em>private</em>
            </p>
            <p>
              <strong>2</strong>
              <span>Drand R opens the bid set</span>
              <em>public</em>
            </p>
            <p>
              <strong>3</strong>
              <span>Soroban pays + refunds</span>
              <em>verifiable</em>
            </p>
          </div>

          <div className="proof-strip">
            <span>{shortAddr(DEMO_TRACE.meta.contractId, 6)}</span>
            <span>sealed auction</span>
            <span>round #{DEMO_TRACE.meta.roundId}</span>
          </div>
        </motion.div>
      </motion.section>

      <motion.section
        className="pilot-banner"
        initial={{ opacity: 0, y: 16 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-80px" }}
        transition={transition}
      >
        <div>
          <span>SCF resubmission focus</span>
          <h2>One wedge: escrow-backed sealed auctions.</h2>
        </div>
        <p>
          The next submission should include a named auction or competitive-bid pilot, public
          testnet round receipts, and partner feedback.
        </p>
        <p>
          Partners integrate the same audited round lifecycle through the SDK without replacing
          their marketplace or product workflow.
        </p>
      </motion.section>

      <section className="pilot-partners-section" aria-labelledby="pilot-partners-title">
        <motion.div
          className="pilot-partners-head"
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={transition}
        >
          <div>
            <span>Real Integration Partners</span>
            <h2 id="pilot-partners-title">Sub Rosa in partner workflows.</h2>
          </div>
          <p>
            Real integrations already use sealed coordination in production-shaped flows, while
            the next pilot extends the same primitive to RWA liquidity.
          </p>
        </motion.div>

        <motion.div
          className="pilot-partners-grid"
          variants={staggerParent}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: "-60px" }}
        >
          {PILOT_PARTNERS.map((partner) =>
            partner.href ? (
              <motion.a
                key={partner.id}
                className="landing-partner-card linked"
                href={partner.href}
                target="_blank"
                rel="noreferrer"
                variants={fadeUp}
                transition={transition}
                whileHover={reduce ? undefined : { y: -4 }}
                whileTap={reduce ? undefined : { scale: 0.99 }}
              >
                <PartnerCardContent partner={partner} />
              </motion.a>
            ) : (
              <motion.article
                key={partner.id}
                className="landing-partner-card"
                variants={fadeUp}
                transition={transition}
              >
                <PartnerCardContent partner={partner} />
              </motion.article>
            ),
          )}
        </motion.div>
      </section>

      <section className="landing-cases-section">
        <motion.div
          className="landing-cases-head"
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={transition}
        >
          <h2>Run a sealed auction round.</h2>
          <p>
            The demo follows the funds path reviewers care about: escrow is locked before reveal,
            bids open together, the winner pays, and losers are refunded.
          </p>
        </motion.div>

        <motion.div
          className="landing-cases"
          variants={staggerParent}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: "-60px" }}
        >
          {USE_CASES.map((item) => (
            <motion.button
              key={item.id}
              type="button"
              className="case-card-link"
              onClick={() => onCase(item.id)}
              variants={fadeUp}
              transition={transition}
              whileHover={reduce ? undefined : { y: -3 }}
              whileTap={reduce ? undefined : { scale: 0.98 }}
            >
              <span>{item.tagline}</span>
              <strong>{item.oneLine}</strong>
            </motion.button>
          ))}
        </motion.div>
      </section>
    </main>
  );
}
