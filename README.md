# VibeChat

VibeChat is a Next.js App Router app for city communities, public posts, and topic-based chat. Supabase provides Google sign-in, profiles, posts, comments, votes, chat messages, reports, blocks, and image storage. Without Supabase configuration, the app shows setup guidance instead of fabricated community content.

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## Environment variables

Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in `.env.local` using the values from Supabase Project Settings > API. These are public client values. Keep Row Level Security enabled, never put a `service_role` key in a `NEXT_PUBLIC_` variable, and do not commit `.env.local`.

## Supabase setup

1. Configure the project URL and anon key in `.env.local`, then restart Next.js.
2. In Supabase Dashboard > Authentication > Providers, enable Google and configure the Google OAuth client. Set its authorized redirect URI to `https://<project-ref>.supabase.co/auth/v1/callback`.
3. In Supabase Dashboard > Authentication > URL Configuration, allow the app callback URL, such as `http://localhost:3000/auth/callback`. Add the exact LAN callback URL if testing from a phone.
4. Apply the migrations in `supabase/migrations` in timestamp order. This creates the posts, profiles, chat, comments, votes, blocks, reports, and image-storage schemas and policies. The post-image policy repair and ensure-image-path migrations are safe to apply in order after the initial image-storage migration.
5. For moderator access, set the trusted Supabase Auth `app_metadata.role` to `moderator` or `admin` for the relevant user. Do not assign moderator privileges through user-editable metadata. Moderator role changes may require a fresh session before the updated JWT claims take effect.

Google OAuth uses the server callback and Supabase-managed cookies. Profile, post, message, comment, vote, report, and block writes require a verified signed-in user and are checked by server routes and database RLS. Reports are private to their reporter and moderators. The chat is shared per city/channel and refreshes by polling; it is not end-to-end encrypted or private messaging.

Posts and profile images use public storage buckets and are publicly viewable. Do not upload content that should remain private. The age gate is currently removed and must be implemented before public launch. Joined cities, favourites, and drafts are stored in this browser; blocking is account-backed and filters the blocked user's posts, comments, and messages for the blocker.

The in-memory rate limiter is a per-process safeguard: limits reset on restart and are not shared across server instances. Production deployment should use a shared rate-limit store and a trusted proxy that overwrites forwarding headers. The current legal pages are draft guidance and require legal review before public launch.

## Validation

```bash
npm run lint
npm run build
```

## Feature boundaries

- Supabase is required for account profiles, shared posts and post images, comments and replies, votes, chat, reports, and blocks.
- Stories, friend/presence previews, voice channels, and chat-image uploads are not implemented and are not presented as working features.
- City membership, favourites, and drafts are browser-local preferences, not shared account settings.
- The age gate is not currently implemented.
