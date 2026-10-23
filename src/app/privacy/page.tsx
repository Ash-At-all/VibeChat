import type { Metadata } from "next";
import { LegalShell } from "@/components/legal-shell";

export const metadata: Metadata = { title: "Privacy" };

export default function PrivacyPage() {
  return (
    <LegalShell>
      <article className="legal-content">
        <p className="eyebrow">Legal</p>
        <h1>Privacy Policy</h1>
        <p className="legal-notice">Preview notice. This page describes the current frontend preview, not a future live service. The policy must be reviewed and updated before accounts or server-backed features launch.</p>
        <h2>What this preview stores</h2>
        <p>There are no accounts, sign-in, or connected community backend in this preview. Posts, comments, chat messages, reports, and other content you enter are kept in the open page only; they are not saved by the app and disappear when you reload or close it. The app saves joined-city and favourite-city preferences, your 18+ self-confirmation, and blocked or locally banned display names in your browser’s local storage. It does not collect your birth date or ID. The standalone HTML mockup saves joined-city preferences only.</p>
        <h2>Where information goes</h2>
        <p>The preview app does not send your content or saved city preferences to a VibeChat server, use analytics or advertising trackers, or set app cookies. The standalone mockup uses system fonts and does not request fonts from an external provider. Like any website, the web host may receive technical connection information, such as your IP address and browser request details, when it serves the page; check the host’s privacy information for its handling and retention practices.</p>
        <h2>Visibility and personal information</h2>
        <p>The current preview does not share content with other users. If community features are enabled in a future service, posts and messages may be visible to people with access to the relevant community. Avoid entering sensitive or identifying information, and do not publish another person’s private information.</p>
        <h2>Your choices</h2>
        <p>Your saved city preferences stay in this browser until you clear this site’s browser data. You can clear them using your browser’s site-data or storage settings; this also removes other data your browser may have saved for the site. Preview content in the open page can be removed by reloading or closing it.</p>
        <h2>Future changes</h2>
        <p>Before accounts or server-backed features launch, this policy must explain the information collected, purposes, recipients and service providers, retention periods, and how to exercise applicable privacy rights. No future collection or sharing is described here as already active.</p>
      </article>
    </LegalShell>
  );
}
