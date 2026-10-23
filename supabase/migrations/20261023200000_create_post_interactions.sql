create table public.post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts (id) on delete cascade,
  parent_id uuid references public.post_comments (id) on delete cascade,
  author_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  body text not null
    check (char_length(body) <= 1000 and char_length(btrim(body)) > 0),
  created_at timestamptz not null default now()
);

create index post_comments_post_created_at_idx
  on public.post_comments (post_id, created_at asc);

create or replace function public.validate_comment_parent()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.parent_id is not null and not exists (
    select 1
    from public.post_comments as parent
    where parent.id = new.parent_id
      and parent.post_id = new.post_id
  ) then
    raise exception 'Parent comment must belong to the same post.';
  end if;
  return new;
end;
$$;

create trigger post_comments_validate_parent
  before insert or update of post_id, parent_id on public.post_comments
  for each row
  execute function public.validate_comment_parent();

alter table public.post_comments enable row level security;

create policy "Anyone can read post comments"
  on public.post_comments
  for select
  to anon, authenticated
  using (true);

create policy "Users can create comments as themselves"
  on public.post_comments
  for insert
  to authenticated
  with check ((select auth.uid()) = author_id);

revoke all on public.post_comments from public, anon, authenticated;
grant select (id, post_id, parent_id, body, created_at) on public.post_comments to anon, authenticated;
grant insert (post_id, parent_id, author_id, body) on public.post_comments to authenticated;

create view public.post_comments_public with (security_barrier = true) as
  select
    comment.id,
    comment.post_id,
    comment.parent_id,
    coalesce(nullif(profile.display_name, ''), profile.username, 'Community member') as author,
    profile.username as author_username,
    comment.body,
    comment.created_at
  from public.post_comments as comment
  left join public.profiles as profile on profile.id = comment.author_id;

revoke all on public.post_comments_public from public, anon, authenticated;
grant select on public.post_comments_public to anon, authenticated;

create view public.posts_public with (security_barrier = true) as
  select
    post.id,
    post.city_slug,
    post.tag,
    post.title,
    post.body,
    post.image_paths,
    post.created_at,
    post.updated_at,
    coalesce(nullif(profile.display_name, ''), profile.username, 'Community member') as author,
    profile.username as author_username,
    profile.avatar_url
  from public.posts as post
  left join public.profiles as profile on profile.id = post.author_id;

revoke all on public.posts_public from public, anon, authenticated;
grant select on public.posts_public to anon, authenticated;

create table public.user_blocks (
  blocker_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  blocked_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

alter table public.user_blocks enable row level security;
create policy "Users can manage their own blocks"
  on public.user_blocks
  for all
  to authenticated
  using ((select auth.uid()) = blocker_id)
  with check ((select auth.uid()) = blocker_id);

revoke all on public.user_blocks from public, anon, authenticated;
grant select (blocker_id, blocked_id, created_at) on public.user_blocks to authenticated;
grant insert (blocker_id, blocked_id), delete on public.user_blocks to authenticated;

create table public.post_votes (
  post_id uuid not null references public.posts (id) on delete cascade,
  author_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  vote smallint not null check (vote in (-1, 1)),
  created_at timestamptz not null default now(),
  primary key (post_id, author_id)
);

alter table public.post_votes enable row level security;

create policy "Users can read their own votes"
  on public.post_votes
  for select
  to authenticated
  using ((select auth.uid()) = author_id);

create policy "Users can create their own votes"
  on public.post_votes
  for insert
  to authenticated
  with check ((select auth.uid()) = author_id);

create policy "Users can update their own votes"
  on public.post_votes
  for update
  to authenticated
  using ((select auth.uid()) = author_id)
  with check ((select auth.uid()) = author_id);

create policy "Users can delete their own votes"
  on public.post_votes
  for delete
  to authenticated
  using ((select auth.uid()) = author_id);

revoke all on public.post_votes from public, anon, authenticated;
grant select (post_id, author_id, vote) on public.post_votes to authenticated;
grant insert (post_id, author_id, vote), update (vote), delete on public.post_votes to authenticated;

create or replace function public.get_post_vote_summary(p_post_id uuid)
returns table (score bigint, my_vote smallint)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce(sum(v.vote)::bigint, 0),
    coalesce(max(v.vote) filter (where v.author_id = (select auth.uid())), 0)::smallint
  from public.post_votes as v
  where v.post_id = p_post_id;
$$;

revoke all on function public.get_post_vote_summary(uuid) from public;
grant execute on function public.get_post_vote_summary(uuid) to anon, authenticated;

create or replace function public.get_post_vote_summaries(p_post_ids uuid[])
returns table (post_id uuid, score bigint, my_vote smallint)
language sql
stable
security definer
set search_path = ''
as $$
  select
    requested.id,
    coalesce(sum(v.vote)::bigint, 0),
    coalesce(max(v.vote) filter (where v.author_id = (select auth.uid())), 0)::smallint
  from unnest(p_post_ids) as requested(id)
  left join public.post_votes as v on v.post_id = requested.id
  group by requested.id;
$$;

revoke all on function public.get_post_vote_summaries(uuid[]) from public;
grant execute on function public.get_post_vote_summaries(uuid[]) to anon, authenticated;

create or replace function public.set_post_vote(p_post_id uuid, p_vote smallint)
returns table (score bigint, my_vote smallint)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in to vote.';
  end if;
  if p_vote not in (-1, 0, 1) then
    raise exception 'Vote must be -1, 0, or 1.';
  end if;
  if not exists (select 1 from public.posts where id = p_post_id) then
    raise exception 'Post not found.';
  end if;

  if p_vote = 0 then
    delete from public.post_votes
      where post_id = p_post_id and author_id = (select auth.uid());
  else
    insert into public.post_votes (post_id, author_id, vote)
      values (p_post_id, (select auth.uid()), p_vote)
      on conflict (post_id, author_id) do update set vote = excluded.vote;
  end if;

  return query select * from public.get_post_vote_summary(p_post_id);
end;
$$;

revoke all on function public.set_post_vote(uuid, smallint) from public;
grant execute on function public.set_post_vote(uuid, smallint) to authenticated;

notify pgrst, 'reload schema';
