alter table public.posts
  add column if not exists image_paths text[] not null default '{}';

alter table public.posts
  drop constraint if exists posts_image_paths_limit;

alter table public.posts
  add constraint posts_image_paths_limit
  check (cardinality(image_paths) <= 4);

grant select (image_paths) on public.posts to anon;
grant insert (image_paths) on public.posts to authenticated;

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

drop trigger if exists posts_validate_image_ownership on public.posts;
create trigger posts_validate_image_ownership
  before insert or update of image_paths on public.posts
  for each row
  execute function public.validate_post_image_ownership();

notify pgrst, 'reload schema';
