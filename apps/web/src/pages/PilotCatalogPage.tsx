import { ArrowRight, ExternalLink, ShieldCheck } from "lucide-react";
import { PILOT_WORKSPACES } from "../config/pilotWorkspaces";

interface PilotCatalogPageProps {
  goHome: () => void;
}

export function PilotCatalogPage({ goHome }: PilotCatalogPageProps) {
  return (
    <main className="pilot-catalog-page">
      <nav className="pilot-catalog-nav">
        <button type="button" className="brand-link" onClick={goHome}>
          <img src="/sub-rosa-logo.png" alt="" />
          <span>Sub Rosa</span>
        </button>
        <div className="pilot-catalog-nav-actions">
          <span className="pilot-catalog-status"><ShieldCheck size={14} /> Pilot workspace</span>
          <a href="#/docs" className="secondary-action compact">Docs</a>
          <a href="https://github.com/karagozemin/Sub-Rosa" target="_blank" rel="noreferrer" className="secondary-action compact">
            GitHub <ExternalLink size={13} />
          </a>
        </div>
      </nav>

      <header className="pilot-catalog-header">
        <div>
          <span className="pilot-catalog-kicker">Choose a pilot</span>
          <h1>Partner workspaces</h1>
          <p>Pick the flow you want to run. Each pilot opens in its own workspace with the controls and evidence for that workflow.</p>
        </div>
          <span className="pilot-catalog-count">
            {PILOT_WORKSPACES.length} interactive workspaces
          </span>
      </header>

      <section className="pilot-catalog-grid" aria-label="Pilot workspaces">
        {PILOT_WORKSPACES.map((pilot, index) => (
          <article className={`pilot-catalog-card ${pilot.className}`} key={pilot.id}>
            <div className="pilot-catalog-card-content">
              <div className="pilot-catalog-card-topline">
                <span className="pilot-catalog-card-index">0{index + 1}</span>
                <span className="pilot-catalog-card-status live">{pilot.statusLabel}</span>
              </div>
              <span className="pilot-catalog-card-eyebrow">{pilot.eyebrow}</span>
              <h2>{pilot.title}</h2>
              <p>{pilot.description}</p>
              <div className="pilot-catalog-card-meta" aria-label="Workspace details">
                <span>{pilot.hosting}</span>
                <span>{pilot.network}</span>
                <span>{pilot.mode}</span>
              </div>
              <div className="pilot-catalog-card-actions">
                <a className="pilot-catalog-card-action primary" href={pilot.href}>
                  Open workspace <ArrowRight size={17} />
                </a>
                {pilot.evidenceLink ? (
                  <a
                    className="pilot-catalog-card-action secondary"
                    href={pilot.evidenceLink.href}
                    target={pilot.evidenceLink.external ? "_blank" : undefined}
                    rel={pilot.evidenceLink.external ? "noreferrer" : undefined}
                  >
                    {pilot.evidenceLink.label}
                    {pilot.evidenceLink.external ? <ExternalLink size={13} /> : <ArrowRight size={14} />}
                  </a>
                ) : null}
              </div>
            </div>
            <div className="pilot-catalog-card-art" aria-hidden="true">
              <img src={pilot.logo} alt="" loading="lazy" />
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}
