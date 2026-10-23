import Link from "next/link";
import type { ReactNode } from "react";
import { SiteBrand } from "./site-brand";

export function LegalShell({ children }: { children: ReactNode }) {
  return (
    <main className="legal-page">
      <header className="legal-header">
        <SiteBrand />
        <Link className="button" href="/">Back to community</Link>
      </header>
      {children}
      <footer className="page-footer">
        <span>VibeChat · Preview</span>
        <span><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link></span>
      </footer>
    </main>
  );
}
