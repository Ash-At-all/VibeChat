do $$
declare
  app_table record;
begin
  for app_table in
    select tables.relname
    from pg_class as tables
    join pg_namespace as schemas on schemas.oid = tables.relnamespace
    where schemas.nspname = 'public'
      and tables.relkind in ('r', 'p')
  loop
    execute format(
      'alter table public.%I enable row level security',
      app_table.relname
    );
  end loop;
end
$$;
