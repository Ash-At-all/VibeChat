create table public.posts (
  id uuid primary key default gen_random_uuid(),
  city_slug text not null
    check (city_slug in (
      'general',
      'agartala',
      'agra',
      'aizawl',
      'ahmedabad',
      'amritsar',
      'amravati',
      'bengaluru',
      'belagavi',
      'bikaner',
      'bhopal',
      'bhubaneswar',
      'chandigarh',
      'chennai',
      'coimbatore',
      'cuttack',
      'dehradun',
      'delhi',
      'dhanbad',
      'erode',
      'faridabad',
      'gandhinagar',
      'gangtok',
      'goa',
      'guntur',
      'gurugram',
      'guwahati',
      'gwalior',
      'hubballi',
      'hyderabad',
      'imphal',
      'indore',
      'itanagar',
      'jabalpur',
      'jaipur',
      'jammu',
      'jalandhar',
      'jamshedpur',
      'jodhpur',
      'kanpur',
      'kochi',
      'kohima',
      'kolhapur',
      'kolkata',
      'kota',
      'kozhikode',
      'lucknow',
      'ludhiana',
      'madurai',
      'mangaluru',
      'meerut',
      'mumbai',
      'mysuru',
      'pune',
      'nagpur',
      'nashik',
      'nanded',
      'navi-mumbai',
      'nellore',
      'noida',
      'patna',
      'port-blair',
      'prayagraj',
      'puducherry',
      'raipur',
      'rajkot',
      'ranchi',
      'sambhajinagar',
      'shillong',
      'shimla',
      'siliguri',
      'srinagar',
      'surat',
      'thane',
      'thiruvananthapuram',
      'thrissur',
      'tirupati',
      'tiruchirappalli',
      'tirunelveli',
      'udaipur',
      'vadodara',
      'varanasi',
      'vijayawada',
      'vellore',
      'visakhapatnam',
      'leh'
    )),
  author_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  tag text not null
    check (tag in ('General', 'Food', 'Jobs', 'Rent', 'Events', 'Question')),
  title text not null
    check (char_length(title) <= 140 and char_length(btrim(title)) > 0),
  body text not null
    check (char_length(body) <= 4000 and char_length(btrim(body)) > 0),
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

create trigger posts_set_updated_at
  before update on public.posts
  for each row
  execute function public.set_updated_at();

create index posts_city_created_at_idx
  on public.posts (city_slug, created_at desc);

create index posts_author_created_at_idx
  on public.posts (author_id, created_at desc);

alter table public.posts enable row level security;

create policy "Anyone can read posts"
  on public.posts
  for select
  to anon, authenticated
  using (true);

create policy "Users can create posts as themselves"
  on public.posts
  for insert
  to authenticated
  with check ((select auth.uid()) = author_id);

create policy "Users can update their own posts"
  on public.posts
  for update
  to authenticated
  using ((select auth.uid()) = author_id)
  with check ((select auth.uid()) = author_id);

create policy "Users can delete their own posts"
  on public.posts
  for delete
  to authenticated
  using ((select auth.uid()) = author_id);

revoke all on public.posts from public, anon, authenticated;
grant select (id, city_slug, tag, title, body, created_at, updated_at)
  on public.posts to anon;
grant select on public.posts to authenticated;
grant insert (city_slug, tag, title, body)
  on public.posts to authenticated;
grant update (city_slug, tag, title, body)
  on public.posts to authenticated;
grant delete on public.posts to authenticated;
