-- Fix: grant table-level permissions on profiles for authenticated users
grant usage on schema public to anon, authenticated;

grant select on public.profiles to anon;
grant all on public.profiles to authenticated;

-- Ensure RLS policies are correct
drop policy if exists "Anyone can read profiles" on public.profiles;
create policy "Anyone can read profiles"
  on public.profiles
  for select
  to anon, authenticated
  using (true);

drop policy if exists "Users can insert their own profile" on public.profiles;
create policy "Users can insert their own profile"
  on public.profiles
  for insert
  to authenticated
  with check ((select auth.uid()) = id);

drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile"
  on public.profiles
  for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

drop policy if exists "Users can delete their own profile" on public.profiles;
create policy "Users can delete their own profile"
  on public.profiles
  for delete
  to authenticated
  using ((select auth.uid()) = id);

notify pgrst, 'reload schema';
