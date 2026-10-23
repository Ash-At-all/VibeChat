import type { Metadata } from "next";
import { LegalShell } from "@/components/legal-shell";

export const metadata: Metadata = { title: "Terms" };

export default function TermsPage() {
  return (
    <LegalShell>
      <article className="legal-content">
        <p className="eyebrow">Legal</p>
        <h1>Terms and Conditions</h1>
        <p className="legal-notice">Preview draft. These terms are not legal advice. Review and adapt them for the final service before launch.</p>
        <h2>Using VibeChat</h2>
        <p>VibeChat is intended for adults aged 18 and over. The current frontend is a demonstration only; accounts, moderation services, and shared community content are not connected.</p>
        <h2>Community conduct</h2>
        <p>Users of the planned service must not harass or threaten others, share private information without consent, impersonate people, spam communities, or use the service for illegal activity.</p>
        <h2>Your content</h2>
        <p>You remain responsible for content you submit. The final terms will explain the limited permission needed to host and display that content as part of the service.</p>
        <h2>Moderation and appeals</h2>
        <p>Community rules, reporting, moderation actions, and a feedback or appeal process will be published before those features are enabled.</p>
        <h2>Availability and changes</h2>
        <p>The service may change or become temporarily unavailable. These preview terms should be replaced with reviewed terms before a public launch.</p>
        <h2>Contact</h2>
        <p>Contact details will be published here before the service launches.</p>
      </article>
    </LegalShell>
  );
}
