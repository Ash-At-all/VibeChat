create table public.messages (
  id uuid primary key default gen_random_uuid(),
  city_slug text not null,
  channel_id text not null,
  author_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  body text not null
    check (char_length(body) <= 2000 and char_length(btrim(body)) > 0),
  created_at timestamptz not null default now()
);

create index messages_city_channel_created_at_idx
  on public.messages (city_slug, channel_id, created_at asc);

alter table public.messages enable row level security;

create policy "Anyone can read messages"
  on public.messages
  for select
  to anon, authenticated
  using (true);

create policy "Users can create messages as themselves"
  on public.messages
  for insert
  to authenticated
  with check ((select auth.uid()) = author_id);

create policy "Users can delete their own messages"
  on public.messages
  for delete
  to authenticated
  using ((select auth.uid()) = author_id);

revoke all on public.messages from public, anon, authenticated;
grant select on public.messages to anon;
grant select, insert, delete on public.messages to authenticated;

notify pgrst, 'reload schema';
