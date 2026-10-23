create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  post_id uuid references public.posts (id) on delete cascade,
  comment_id uuid references public.post_comments (id) on delete cascade,
  reason text not null
    check (reason in ('harassment', 'hate', 'spam', 'personal-information', 'violence', 'other')),
  details text not null default ''
    check (char_length(details) <= 500),
  status text not null default 'open'
    check (status in ('open', 'reviewed', 'actioned')),
  created_at timestamptz not null default now(),
  check ((post_id is not null)::integer + (comment_id is not null)::integer = 1)
);

create index reports_reporter_created_at_idx
  on public.reports (reporter_id, created_at desc);
create index reports_open_created_at_idx
  on public.reports (created_at desc)
  where status = 'open';

alter table public.reports enable row level security;

create policy "Users can read their own reports"
  on public.reports
  for select
  to authenticated
  using ((select auth.uid()) = reporter_id);

create policy "Users can submit their own reports"
  on public.reports
  for insert
  to authenticated
  with check ((select auth.uid()) = reporter_id);

create policy "Moderators can review reports"
  on public.reports
  for select
  to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') in ('moderator', 'admin'));

create policy "Moderators can update report status"
  on public.reports
  for update
  to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') in ('moderator', 'admin'))
  with check ((select auth.jwt() -> 'app_metadata' ->> 'role') in ('moderator', 'admin'));

revoke all on public.reports from public, anon, authenticated;
grant select on public.reports to authenticated;
grant insert (reporter_id, post_id, comment_id, reason, details)
  on public.reports to authenticated;
grant update (status) on public.reports to authenticated;

notify pgrst, 'reload schema';
