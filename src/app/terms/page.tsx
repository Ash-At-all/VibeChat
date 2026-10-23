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
        <p>VibeChat is intended for adults aged 18 and over, but the age gate is currently not implemented and the service does not verify age. When the service operator has configured Supabase, accounts, public posts, city chat, profiles, reporting, and blocking use the connected backend. Availability depends on that configuration.</p>
        <h2>Community conduct</h2>
        <p>Do not harass or threaten others, share private information without consent, impersonate people, spam communities, or use the service for illegal activity. Reports are submitted to the configured project’s authorized moderators. Blocking filters an account from your view; it does not delete their content or prevent all contact outside your view.</p>
        <h2>Your content</h2>
        <p>You remain responsible for content you submit. Posts, profile images, avatars, comments, and chat messages are designed to be publicly visible to people using the configured project. Do not submit content you do not have the right to share or want to keep private. The service operator must define an appropriate content license in final terms before public launch.</p>
        <h2>Moderation and appeals</h2>
        <p>The current app accepts reports and lets authorized moderators mark them reviewed or actioned. It does not automatically remove reported content or apply account bans. The service operator must publish moderation standards and an appeal process before public launch.</p>
        <h2>Availability and changes</h2>
        <p>The service may change or become temporarily unavailable. These preview terms should be replaced with reviewed terms before a public launch.</p>
        <h2>Contact</h2>
        <p>Contact details will be published here before the service launches.</p>
      </article>
    </LegalShell>
  );
}
