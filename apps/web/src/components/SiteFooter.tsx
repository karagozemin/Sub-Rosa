import { ArrowUpRight } from "lucide-react";
import { LOGO_SRC } from "../lib/chain";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <a className="site-footer-brand" href="#/" aria-label="Sub Rosa home">
          <img src={LOGO_SRC} alt="" />
          <span>
            <strong>Sub Rosa</strong>
            <small>Private by design. Verifiable by default.</small>
          </span>
        </a>

        <span className="site-footer-note">Sealed infrastructure for open markets.</span>

        <a
          className="site-footer-social"
          href="https://x.com/SubRosa_HQ"
          target="_blank"
          rel="noreferrer"
          aria-label="Follow Sub Rosa on X (Twitter)"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="currentColor"
              d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.451-6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77Z"
            />
          </svg>
          <span>@SubRosa_HQ</span>
          <ArrowUpRight size={14} aria-hidden="true" />
        </a>
      </div>
    </footer>
  );
}
