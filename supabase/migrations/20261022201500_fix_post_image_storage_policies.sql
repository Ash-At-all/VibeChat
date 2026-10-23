drop policy if exists "Signed-in users upload their own post images" on storage.objects;
create policy "Signed-in users upload their own post images"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'post-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and lower(storage.extension(name)) = 'webp'
  );

drop policy if exists "Users can read their own post image objects" on storage.objects;
create policy "Users can read their own post image objects"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'post-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Users can update their own post image objects" on storage.objects;
create policy "Users can update their own post image objects"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'post-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'post-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and lower(storage.extension(name)) = 'webp'
  );

drop policy if exists "Users can delete their own post image objects" on storage.objects;
create policy "Users can delete their own post image objects"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'post-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create or replace function public.validate_post_image_ownership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from unnest(new.image_paths) as paths(path)
    where split_part(paths.path, '/', 1) <> (select auth.uid())::text
      or not exists (
        select 1
        from storage.objects
        where bucket_id = 'post-images'
          and name = paths.path
      )
  ) then
    raise exception 'Post images must belong to the signed-in user';
  end if;
  return new;
end;
$$;

revoke all on function public.validate_post_image_ownership() from public, anon, authenticated;
