# VibeChat

VibeChat is a Next.js App Router frontend for city communities, local posts, and topic-based chat. The current build is a frontend preview: posts and messages are mock data and are not shared with other people.

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## Environment variables

Supabase browser configuration belongs in `.env.local` as `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`; copy their values from Supabase Project Settings > API. These are public client values, not secrets. Keep Row Level Security enabled, and never put a `service_role` key or other private secret in a `NEXT_PUBLIC_` variable. `.env.local` is ignored by Git.

## Supabase post schema preparation

The initial posts-table migration is in `supabase/migrations/20261022171000_create_posts.sql`. When the Supabase project is available, apply migrations through the Supabase CLI or SQL Editor. `20261022172000_enable_rls_for_public_tables.sql` enables RLS on every existing regular or partitioned table in the `public` schema; the posts migration defines its access policies. Posts are readable by anyone, while only signed-in users can create posts and update/delete their own. The database derives `author_id` from `auth.uid()`; client roles have no insert or update permission on that column. Anonymous readers cannot access author UUIDs. City slugs, tags, and text lengths are validated in the database. For every new public table, enable RLS and define least-privilege policies before granting API roles access. The current frontend still uses mock data and is not connected to this schema.

Run the checks with:

```bash
npm run lint
npm run build
```

## Current preview

- Responsive city navigation for 85 major Indian cities. General Chat is joined by default; other cities are opt-in. Joined cities and favourites are saved in this browser.
- City boards show that city's posts; General Chat shows posts from every city. City selection opens that city's chat on mobile.
- Phone and small-tablet chat uses a compact Friends strip, collapsible city/channel rails, and a bottom composer. Friend profiles and presence are static demo UI; chat messages remain local to the page, and voice chat does not access a microphone or connect to a service.
- Demo story previews appear above the feed. They are sample UI, not real friend accounts or uploaded stories.
- Mock posts with topics, votes, nested replies, edit/delete controls for locally created posts, and local board search.
- Post and chat image selections accept JPEG, PNG, and WebP up to 5 MB before processing, then compress in the browser to WebP (longest side at most 1600 px and output at most 1.5 MB). Posts allow up to 4 images; a chat message allows one. The profile dialog's local avatar preview accepts up to 1 MB and compresses to WebP at up to 512×512. These object-URL previews stay in memory and are never uploaded; reloading clears them. There is no persistent image storage or server upload endpoint yet.
- Post create/edit inputs are checked in the browser and revalidated by `POST /api/posts/validate` using the shared Zod schemas in `src/lib/post-schema.ts`; unknown fields such as `author_id` are rejected. Comments and messages are similarly validated by `/api/comments/validate` and `/api/messages/validate`. These endpoints only validate and rate-limit; they do not save content. The preview continues to store posts/comments/messages locally in page memory.
- Server-side rate limits are 5 post create/edit requests per hour, 30 comments per hour, and 30 messages per minute, grouped by the request IP. The in-memory limiter and per-process HMAC-hashed IP keys are a preview safeguard only: limits reset on process restart and are not shared between server instances. Production deployment must use a shared rate-limit store and configure a trusted proxy to overwrite `X-Real-IP`/`X-Forwarded-For`; do not trust client-supplied forwarding headers.
- General Chat channels for Chit-chat, Meetings, Problem-solving, and Help.
- A required 18+ self-confirmation gate is shown before entering; only the confirmation flag is saved in this browser, not a birth date or ID. Reporting offers categories and optional details, then adds the report to a local preview queue. Users can block/unblock authors; the preview moderation queue can dismiss reports, apply/remove local preview bans, and hides blocked/banned authors' posts and comments. Block/ban names persist in this browser; reports stay in page memory. None of these actions contacts moderators, creates accounts, or enforces a real ban.
- Privacy and Terms preview pages.
- Joined-city and favourite-city preferences, 18+ confirmation, and blocked/preview-banned display names are saved in this browser. Posts, comments, messages, and reports stay in page memory and are not sent to a VibeChat backend.

## Planned phases

1. Frontend preview with mock data, loading/error/empty states, responsive layout, and legal pages.
2. Supabase Auth and PostgreSQL, shared accounts, and editable profiles.
3. Persistent real-time chat, reports, blocks, moderator controls, and rate limiting.
4. Server-backed search, notifications, and validated image uploads.
5. LiveKit voice channels and moderator controls.

Do not treat the preview Privacy Policy or Terms as launch-ready legal documents.
