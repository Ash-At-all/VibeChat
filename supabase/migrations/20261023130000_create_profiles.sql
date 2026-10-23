create table public.profiles (
  id uuid primary key default gen_random_uuid()
    references auth.users (id) on delete cascade,
  username text not null unique
    check (char_length(username) >= 2 and char_length(username) <= 30
      and username ~ '^[a-z0-9_]+$'),
  display_name text not null default ''
    check (char_length(display_name) <= 60),
  tag text
    check (char_length(tag) <= 40),
  avatar_url text
    check (char_length(avatar_url) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row
  execute function public.set_updated_at();

create index profiles_username_idx on public.profiles (username);

alter table public.profiles enable row level security;

create policy "Anyone can read profiles"
  on public.profiles
  for select
  to anon, authenticated
  using (true);

create policy "Users can insert their own profile"
  on public.profiles
  for insert
  to authenticated
  with check ((select auth.uid()) = id);

create policy "Users can update their own profile"
  on public.profiles
  for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

create policy "Users can delete their own profile"
  on public.profiles
  for delete
  to authenticated
  using ((select auth.uid()) = id);

revoke all on public.profiles from public, anon, authenticated;
grant select (id, username, display_name, tag, avatar_url, created_at, updated_at)
  on public.profiles to anon;
grant select on public.profiles to authenticated;
grant insert (id, username, display_name, tag, avatar_url)
  on public.profiles to authenticated;
grant update (username, display_name, tag, avatar_url)
  on public.profiles to authenticated;
grant delete on public.profiles to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 1048576, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Signed-in users upload their own avatars" on storage.objects;
create policy "Signed-in users upload their own avatars"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and lower(storage.extension(name)) in ('jpg', 'jpeg', 'png', 'webp')
  );

drop policy if exists "Anyone can read avatars" on storage.objects;
create policy "Anyone can read avatars"
  on storage.objects
  for select
  to anon, authenticated
  using (bucket_id = 'avatars');

drop policy if exists "Users can update their own avatars" on storage.objects;
create policy "Users can update their own avatars"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and lower(storage.extension(name)) in ('jpg', 'jpeg', 'png', 'webp')
  );

drop policy if exists "Users can delete their own avatars" on storage.objects;
create policy "Users can delete their own avatars"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

notify pgrst, 'reload schema';
