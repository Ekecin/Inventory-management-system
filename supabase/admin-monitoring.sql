-- Gratitude Technologies Inventory: admin monitoring
-- Run once in Supabase Dashboard > SQL Editor (after schema.sql). Safe to re-run.
--
-- What this adds
--   admins            who is allowed to open /admin
--   activity_logs     one row per API call made by the app (who, what, ok/error, how long)
--   user_presence     one row per user, refreshed by a heartbeat while they use the app
--   monitoring_rules  the rule set the dashboard evaluates (editable from /admin)
--   RPC functions     the app writes through functions that stamp the real user id/email
--                     from the login token, so a user cannot log activity as someone else.
--                     The admin_* functions refuse anyone who is not in the admins table.

-- 1. Admins ---------------------------------------------------------------
create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.admins enable row level security;

drop policy if exists "Admins can see their own row" on public.admins;
create policy "Admins can see their own row"
  on public.admins for select
  to authenticated using (user_id = (select auth.uid()));
-- No insert/update/delete policies: admins are added from the SQL editor only.

create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (select 1 from public.admins where user_id = (select auth.uid()));
$$;

-- 2. Activity log -----------------------------------------------------------
create table if not exists public.activity_logs (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  user_email text,
  action text not null check (char_length(action) <= 80),      -- e.g. inventory.select
  method text not null default 'GET' check (method in ('GET','POST','PATCH','DELETE','AUTH')),
  status text not null check (status in ('success','error')),
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  error_message text check (char_length(error_message) <= 300),
  created_at timestamptz not null default now()
);
create index if not exists activity_logs_created_idx on public.activity_logs (created_at desc);
create index if not exists activity_logs_user_idx on public.activity_logs (user_id, created_at desc);
create index if not exists activity_logs_action_idx on public.activity_logs (action, created_at desc);

alter table public.activity_logs enable row level security;
drop policy if exists "Admins can read activity" on public.activity_logs;
create policy "Admins can read activity"
  on public.activity_logs for select
  to authenticated using (public.is_admin());
-- No insert policy: rows are written only through log_activity() below.

-- 3. Presence ---------------------------------------------------------------
create table if not exists public.user_presence (
  user_id uuid primary key references auth.users(id) on delete cascade,
  user_email text,
  current_view text,
  user_agent text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
alter table public.user_presence enable row level security;
drop policy if exists "Admins can read presence" on public.user_presence;
create policy "Admins can read presence"
  on public.user_presence for select
  to authenticated using (public.is_admin());

-- 4. Rules ------------------------------------------------------------------
create table if not exists public.monitoring_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  metric text not null check (metric in (
    'requests_per_user','errors_per_user','failed_logins',
    'deletes_per_user','total_requests','error_rate')),
  window_minutes integer not null check (window_minutes between 1 and 1440),
  threshold numeric not null check (threshold >= 0),
  severity text not null default 'warning' check (severity in ('info','warning','critical')),
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.monitoring_rules enable row level security;
drop policy if exists "Admins manage rules" on public.monitoring_rules;
create policy "Admins manage rules"
  on public.monitoring_rules for all
  to authenticated using (public.is_admin()) with check (public.is_admin());

insert into public.monitoring_rules (name, metric, window_minutes, threshold, severity)
select * from (values
  ('High request rate',          'requests_per_user', 1,  60,  'warning'),
  ('Repeated failed sign-ins',   'failed_logins',     10, 5,   'critical'),
  ('Mass deletion',              'deletes_per_user',  5,  10,  'critical'),
  ('Elevated error rate (%)',    'error_rate',        15, 20,  'warning'),
  ('User error burst',           'errors_per_user',   5,  10,  'warning'),
  ('Traffic spike',              'total_requests',    5,  500, 'info')
) as seed(name, metric, window_minutes, threshold, severity)
where not exists (select 1 from public.monitoring_rules);

-- 5. Write path used by the app ---------------------------------------------
create or replace function public.log_activity(events jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_email text := auth.jwt() ->> 'email';
  e jsonb;
  v_ms text;
begin
  if events is null or jsonb_typeof(events) <> 'array' then return; end if;

  for e in select * from jsonb_array_elements(events) limit 50 loop
    -- Signed-out visitors may only report sign-in / sign-up attempts.
    if v_uid is null and coalesce(e ->> 'action', '') not like 'auth.%' then
      continue;
    end if;
    v_ms := e ->> 'duration_ms';
    insert into public.activity_logs (user_id, user_email, action, method, status, duration_ms, error_message)
    values (
      v_uid,
      coalesce(v_email, left(e ->> 'email', 120)),
      left(coalesce(e ->> 'action', 'unknown'), 80),
      case when e ->> 'method' in ('GET','POST','PATCH','DELETE','AUTH') then e ->> 'method' else 'GET' end,
      case when e ->> 'status' = 'error' then 'error' else 'success' end,
      case when v_ms ~ '^[0-9]{1,7}$' then v_ms::integer else null end,
      left(e ->> 'error', 300)
    );
  end loop;
end;
$$;

create or replace function public.touch_presence(p_view text default null, p_agent text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then return; end if;
  insert into public.user_presence (user_id, user_email, current_view, user_agent)
  values (auth.uid(), auth.jwt() ->> 'email', left(p_view, 60), left(p_agent, 200))
  on conflict (user_id) do update
    set last_seen_at = now(),
        user_email = excluded.user_email,
        current_view = excluded.current_view,
        user_agent = excluded.user_agent;
end;
$$;

create or replace function public.end_presence()
returns void
language sql
security definer
set search_path = public
as $$
  update public.user_presence
     set last_seen_at = least(last_seen_at, now() - interval '5 minutes')
   where user_id = auth.uid();
$$;

-- 6. Read path used by /admin -------------------------------------------------
create or replace function public.admin_snapshot(p_minutes integer default 60)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_mins integer := least(greatest(coalesce(p_minutes, 60), 1), 1440);
  v_bucket integer := greatest(1, ceil(v_mins / 60.0)::integer);
  v_since timestamptz := now() - make_interval(mins => v_mins);
  v_result jsonb;
begin
  if not public.is_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'server_time', now(),
    'online_count', (select count(*) from public.user_presence
                      where last_seen_at > now() - interval '90 seconds'),
    'users', coalesce((
      select jsonb_agg(u order by u.seconds_ago)
      from (
        select user_id, user_email, current_view, user_agent, last_seen_at,
               extract(epoch from (now() - last_seen_at))::integer as seconds_ago
        from public.user_presence
        where last_seen_at > now() - interval '24 hours'
        order by last_seen_at desc
        limit 100
      ) u), '[]'::jsonb),
    'totals', (
      select jsonb_build_object(
        'calls', count(*),
        'errors', count(*) filter (where status = 'error'),
        'unique_users', count(distinct user_id),
        'avg_ms', coalesce(round(avg(duration_ms))::integer, 0))
      from public.activity_logs where created_at >= v_since),
    'endpoints', coalesce((
      select jsonb_agg(e order by e.calls desc)
      from (
        select action, method,
               count(*) as calls,
               count(*) filter (where status = 'error') as errors,
               coalesce(round(avg(duration_ms))::integer, 0) as avg_ms,
               coalesce(round(percentile_cont(0.95) within group (order by duration_ms))::integer, 0) as p95_ms
        from public.activity_logs
        where created_at >= v_since
        group by action, method
        order by count(*) desc
        limit 20
      ) e), '[]'::jsonb),
    'timeline', coalesce((
      select jsonb_agg(jsonb_build_object('t', s.t, 'calls', coalesce(a.calls, 0), 'errors', coalesce(a.errors, 0)) order by s.t)
      from (
        select generate_series(
          date_bin(make_interval(mins => v_bucket), v_since, timestamptz '2000-01-01'),
          date_bin(make_interval(mins => v_bucket), now(), timestamptz '2000-01-01'),
          make_interval(mins => v_bucket)) as t
      ) s
      left join (
        select date_bin(make_interval(mins => v_bucket), created_at, timestamptz '2000-01-01') as t,
               count(*) as calls,
               count(*) filter (where status = 'error') as errors
        from public.activity_logs
        where created_at >= v_since
        group by 1
      ) a on a.t = s.t), '[]'::jsonb),
    'top_users', coalesce((
      select jsonb_agg(t order by t.calls desc)
      from (
        select coalesce(user_email, 'unknown') as user_email,
               count(*) as calls,
               count(*) filter (where status = 'error') as errors,
               max(created_at) as last_active
        from public.activity_logs
        where created_at >= v_since and user_id is not null
        group by user_id, user_email
        order by count(*) desc
        limit 10
      ) t), '[]'::jsonb),
    'recent', coalesce((
      select jsonb_agg(r order by r.id desc)
      from (
        select id, created_at, coalesce(user_email, 'anonymous') as user_email,
               action, method, status, duration_ms, error_message
        from public.activity_logs
        order by id desc
        limit 40
      ) r), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

create or replace function public.admin_alerts()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not public.is_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;

  return coalesce((
    select jsonb_agg(a order by a.sev_rank desc, a.value desc)
    from (
      select r.id as rule_id, r.name as rule, r.severity, r.metric,
             r.window_minutes, r.threshold, hit.subject, hit.value,
             case r.severity when 'critical' then 3 when 'warning' then 2 else 1 end as sev_rank
      from public.monitoring_rules r
      cross join lateral (
          select coalesce(l.user_email, 'unknown')::text as subject, count(*)::numeric as value
            from public.activity_logs l
           where r.metric = 'requests_per_user' and l.user_id is not null
             and l.created_at >= now() - make_interval(mins => r.window_minutes)
           group by l.user_id, l.user_email
          union all
          select coalesce(l.user_email, 'unknown')::text, count(*)::numeric
            from public.activity_logs l
           where r.metric = 'errors_per_user' and l.user_id is not null and l.status = 'error'
             and l.created_at >= now() - make_interval(mins => r.window_minutes)
           group by l.user_id, l.user_email
          union all
          select coalesce(l.user_email, 'unknown')::text, count(*)::numeric
            from public.activity_logs l
           where r.metric = 'failed_logins' and l.action = 'auth.login' and l.status = 'error'
             and l.created_at >= now() - make_interval(mins => r.window_minutes)
           group by l.user_email
          union all
          select coalesce(l.user_email, 'unknown')::text, count(*)::numeric
            from public.activity_logs l
           where r.metric = 'deletes_per_user' and l.user_id is not null and l.method = 'DELETE'
             and l.created_at >= now() - make_interval(mins => r.window_minutes)
           group by l.user_id, l.user_email
          union all
          select 'All users'::text, count(*)::numeric
            from public.activity_logs l
           where r.metric = 'total_requests'
             and l.created_at >= now() - make_interval(mins => r.window_minutes)
          union all
          select 'All users'::text,
                 round(100.0 * count(*) filter (where l.status = 'error') / nullif(count(*), 0), 1)::numeric
            from public.activity_logs l
           where r.metric = 'error_rate'
             and l.created_at >= now() - make_interval(mins => r.window_minutes)
          having count(*) >= 10
      ) hit(subject, value)
      where r.enabled and hit.value > r.threshold
    ) a), '[]'::jsonb);
end;
$$;

-- Housekeeping: call from the SQL editor (or pg_cron) to keep the log table small.
create or replace function public.purge_activity_logs(p_days integer default 30)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_count integer;
begin
  if not public.is_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  delete from public.activity_logs where created_at < now() - make_interval(days => greatest(p_days, 1));
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- 7. Function permissions -----------------------------------------------------
revoke all on function public.is_admin() from public, anon;
revoke all on function public.log_activity(jsonb) from public;
revoke all on function public.touch_presence(text, text) from public, anon;
revoke all on function public.end_presence() from public, anon;
revoke all on function public.admin_snapshot(integer) from public, anon;
revoke all on function public.admin_alerts() from public, anon;
revoke all on function public.purge_activity_logs(integer) from public, anon;

grant execute on function public.is_admin() to authenticated;
grant execute on function public.log_activity(jsonb) to anon, authenticated;
grant execute on function public.touch_presence(text, text) to authenticated;
grant execute on function public.end_presence() to authenticated;
grant execute on function public.admin_snapshot(integer) to authenticated;
grant execute on function public.admin_alerts() to authenticated;
grant execute on function public.purge_activity_logs(integer) to authenticated;

-- 8. Make yourself an admin (edit the email, then run this line) ---------------
-- insert into public.admins (user_id)
--   select id from auth.users where email = 'you@example.com'
--   on conflict do nothing;
