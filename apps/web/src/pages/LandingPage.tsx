import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ChevronDown } from "lucide-react";
import { DEMO_TRACE } from "../demo/trace";
import { USE_CASES, type UseCaseId } from "../config/useCases";
import {
  ADDITIONAL_ECOSYSTEM_PARTNERS,
  FEATURED_ECOSYSTEM_PARTNERS,
  type EcosystemLink,
  type EcosystemPartner,
} from "../config/ecosystem";
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

const ECOSYSTEM_HINT_STORAGE_KEY = "sub-rosa:ecosystem-hint-dismissed";

function linkTarget(link: EcosystemLink) {
  return link.external ? { target: "_blank", rel: "noreferrer" } : {};
}

function PartnerLogo({ partner }: { partner: EcosystemPartner }) {
  return (
    <div className={`landing-partner-logo ${partner.id}`}>
      {partner.logo ? (
        <img src={partner.logo} alt={`${partner.name} logo`} loading="lazy" />
      ) : (
        <span className="landing-partner-mark" aria-hidden="true">{partner.mark}</span>
      )}
    </div>
  );
}

function PartnerCardContent({ partner }: { partner: EcosystemPartner }) {
  return (
    <>
      <PartnerLogo partner={partner} />
      <div className="landing-partner-card-body">
        <div className="landing-partner-card-topline">
          <span className={partner.statusTone}>{partner.statusLabel}</span>
          <small>{partner.meta}</small>
        </div>
        <h3>{partner.name}</h3>
        <p>{partner.description}</p>
        <div className="landing-partner-card-actions">
          <a
            className="landing-partner-card-cta primary"
            href={partner.primaryLink.href}
            {...linkTarget(partner.primaryLink)}
          >
            {partner.primaryLink.label}
            <span aria-hidden="true">{partner.primaryLink.external ? "↗" : "→"}</span>
          </a>
          {partner.secondaryLink ? (
            <a
              className="landing-partner-card-cta"
              href={partner.secondaryLink.href}
              {...linkTarget(partner.secondaryLink)}
            >
              {partner.secondaryLink.label}
              <span aria-hidden="true">{partner.secondaryLink.external ? "↗" : "→"}</span>
            </a>
          ) : null}
        </div>
      </div>
    </>
  );
}

function CompactPartner({ partner }: { partner: EcosystemPartner }) {
  return (
    <article className="ecosystem-compact-card">
      <div className="ecosystem-compact-topline">
        <span className={partner.statusTone}>{partner.statusLabel}</span>
        <small>{partner.meta}</small>
      </div>
      <h3>{partner.name}</h3>
      <p>{partner.description}</p>
      <div className="ecosystem-compact-actions">
        <a href={partner.primaryLink.href} {...linkTarget(partner.primaryLink)}>
          {partner.primaryLink.label} <span aria-hidden="true">{partner.primaryLink.external ? "↗" : "→"}</span>
        </a>
        {partner.secondaryLink ? (
          <a href={partner.secondaryLink.href} {...linkTarget(partner.secondaryLink)}>
            {partner.secondaryLink.label} <span aria-hidden="true">{partner.secondaryLink.external ? "↗" : "→"}</span>
          </a>
        ) : null}
      </div>
    </article>
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
  const [showScrollCue, setShowScrollCue] = useState(true);
  const [ecosystemOpen, setEcosystemOpen] = useState(false);
  const [ecosystemHintDismissed, setEcosystemHintDismissed] = useState(() => {
    if (typeof window === "undefined") return true;

    try {
      return window.localStorage.getItem(ECOSYSTEM_HINT_STORAGE_KEY) === "true";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    const updateScrollCue = () => setShowScrollCue(window.scrollY < 96);

    updateScrollCue();
    window.addEventListener("scroll", updateScrollCue, { passive: true });
    return () => window.removeEventListener("scroll", updateScrollCue);
  }, []);

  const scrollToOverview = () => {
    document.getElementById("product-overview")?.scrollIntoView({
      behavior: reduce ? "auto" : "smooth",
      block: "start",
    });
  };

  const toggleEcosystem = () => {
    if (!ecosystemOpen && !ecosystemHintDismissed) {
      setEcosystemHintDismissed(true);
      try {
        window.localStorage.setItem(ECOSYSTEM_HINT_STORAGE_KEY, "true");
      } catch {
        // The hint still stays dismissed for this page view when storage is unavailable.
      }
    }

    setEcosystemOpen((open) => !open);
  };

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
            Sealed coordination infrastructure on Stellar
          </span>
          <motion.h1 variants={fadeUp} transition={transition}>
            Sealed auctions. <em>Settled on Stellar.</em>
          </motion.h1>
          <motion.p className="lede" variants={fadeUp} transition={transition}>
            Use Auction for escrow-backed on-chain settlement, or ReceiptOnly for sealed
            coordination and verifiable outcomes without Sub Rosa holding funds.
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
              <span>Protocol modes</span>
              <strong>Auction · ReceiptOnly</strong>
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

      <motion.button
        type="button"
        className="landing-scroll-cue"
        aria-label="Scroll to explore Sub Rosa"
        onClick={scrollToOverview}
        initial={false}
        animate={{ opacity: showScrollCue ? 1 : 0, x: "-50%", y: showScrollCue ? 0 : 12 }}
        transition={{ duration: reduce ? 0 : 0.24 }}
        style={{ pointerEvents: showScrollCue ? "auto" : "none" }}
      >
        <span>Scroll to explore</span>
        <ChevronDown aria-hidden="true" size={15} strokeWidth={2} />
      </motion.button>

      <motion.section
        id="product-overview"
        className="pilot-banner"
        initial={{ opacity: 0, y: 16 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-80px" }}
        transition={transition}
      >
        <div>
          <span>Two coordination modes</span>
          <h2>Private until the deadline. Verifiable after it.</h2>
        </div>
        <p>
          <strong>Auction</strong> locks escrow, reveals bids at the shared boundary, settles the
          winning exchange on Soroban, and refunds the rest.
        </p>
        <p>
          <strong>ReceiptOnly</strong> seals proposals or assessments and produces a canonical,
          verifiable outcome receipt while the application keeps selection and payment control.
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
            <span>Verified ecosystem activity</span>
            <h2 id="pilot-partners-title">Sub Rosa in partner workflows.</h2>
          </div>
          <p>
            Published adapters, partner-owned code, hosted pilots, and proposed collaborations are
            labeled separately—with direct evidence for every material claim.
          </p>
        </motion.div>

        <motion.div
          className="pilot-partners-grid"
          variants={staggerParent}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: "-60px" }}
        >
          {FEATURED_ECOSYSTEM_PARTNERS.map((partner) => (
            <motion.article
              key={partner.id}
              className="landing-partner-card linked"
              variants={fadeUp}
              transition={transition}
              whileHover={reduce ? undefined : { y: -4 }}
            >
              <PartnerCardContent partner={partner} />
            </motion.article>
          ))}
        </motion.div>

        <section className={`ecosystem-disclosure${ecosystemOpen ? " open" : ""}`}>
          <button
            type="button"
            className="ecosystem-disclosure-toggle"
            aria-expanded={ecosystemOpen}
            aria-controls="ecosystem-all-partners"
            onClick={toggleEcosystem}
          >
            <span className="ecosystem-disclosure-copy">
              <strong>Explore all integrations &amp; collaborations</strong>
              <small>
                {ADDITIONAL_ECOSYSTEM_PARTNERS.length} more pilots and collaboration paths · Select to expand
              </small>
            </span>
            <span className="ecosystem-disclosure-action" aria-hidden="true">
              {!ecosystemHintDismissed ? (
                <span className="ecosystem-click-hint">
                  <img src="/ui/click-hand.png" alt="" />
                </span>
              ) : null}
              <b className="ecosystem-action-collapsed">Open full ecosystem</b>
              <b className="ecosystem-action-expanded">Close ecosystem</b>
              <em>+{ADDITIONAL_ECOSYSTEM_PARTNERS.length}</em>
              <ChevronDown className="ecosystem-disclosure-chevron" size={16} strokeWidth={2} />
            </span>
          </button>
          <AnimatePresence initial={false}>
            {ecosystemOpen ? (
              <motion.div
                id="ecosystem-all-partners"
                className="ecosystem-compact-reveal"
                initial={{ height: 0, opacity: 0, y: -6 }}
                animate={{ height: "auto", opacity: 1, y: 0 }}
                exit={{ height: 0, opacity: 0, y: -4 }}
                transition={{
                  duration: reduce ? 0 : 0.36,
                  ease: [0.22, 1, 0.36, 1],
                }}
              >
                <div className="ecosystem-compact-grid">
                  {ADDITIONAL_ECOSYSTEM_PARTNERS.map((partner) => (
                    <CompactPartner key={partner.id} partner={partner} />
                  ))}
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </section>
      </section>

      <section className="landing-cases-section">
        <motion.div
          className="landing-cases-head"
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={transition}
        >
          <h2>Explore the sealed-round lifecycle.</h2>
          <p>
            The interactive demo follows the Auction funds path: escrow locks before reveal, bids
            open together, the winner pays, and losing bidders are refunded.
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
