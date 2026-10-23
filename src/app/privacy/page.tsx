import type { Metadata } from "next";
import { LegalShell } from "@/components/legal-shell";

export const metadata: Metadata = { title: "Privacy" };

export default function PrivacyPage() {
  return (
    <LegalShell>
      <article className="legal-content">
        <p className="eyebrow">Legal</p>
        <h1>Privacy Policy</h1>
        <p className="legal-notice">Draft notice. This summary describes the application’s current features, but is not a complete privacy policy or legal advice. The service operator must add contact, retention, jurisdiction-specific rights, and provider details and obtain legal review before public launch.</p>
        <h2>Information the app handles</h2>
        <p>When Supabase is configured, Google sign-in creates an account session. VibeChat stores profile information you submit (username, display name, optional tag and avatar), public posts and attached images, comments, votes, chat messages, reports, and account blocks in the configured Supabase project. Reports are visible to the reporter and authorized moderators. The app currently does not implement an age gate or request a birth date or identity document.</p>
        <p>Joined cities, favourites, post and chat drafts are stored in this browser. The app’s server-side rate limiter temporarily derives hashed keys from request network addresses in process memory; it does not persist those keys, but the hosting provider and Supabase may process technical request information under their own terms.</p>
        <h2>Visibility and storage providers</h2>
        <p>Profiles, posts, post images, avatars, comments, and city/channel messages are designed to be publicly readable by users of the configured project. Blocking filters content in the blocker’s view; it does not delete content or hide the blocker from the blocked account. Do not submit sensitive information or content you intend to keep private. Supabase and the application’s hosting provider process information to provide the service; consult the operator’s provider and retention disclosures for details.</p>
        <h2>Your choices</h2>
        <p>You can edit your profile, delete your own posts, manage your blocks, and clear browser-local preferences using your browser’s site-data settings. The current interface lets users submit reports, but does not provide account deletion or a complete data-export workflow. Contact the service operator for account or privacy requests; operator contact information must be published before launch.</p>
        <h2>Security and changes</h2>
        <p>Database access is protected by Supabase Row Level Security and application routes. No online service can guarantee absolute security. The operator must publish applicable retention periods, privacy-rights instructions, and any changes to the service’s data practices before public launch.</p>
      </article>
    </LegalShell>
  );
}
