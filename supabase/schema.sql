-- Gratitude Technologies Inventory Management
-- Run this once in Supabase Dashboard > SQL Editor.
-- This schema enables row-level security and keeps each user's inventory private.

create table if not exists public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  sku text not null default '',
  category text not null default 'General',
  quantity integer not null default 0 check (quantity >= 0),
  unit_price numeric(12,2) not null default 0 check (unit_price >= 0),
  reorder_level integer not null default 5 check (reorder_level >= 0),
  supplier text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists inventory_items_user_id_idx
  on public.inventory_items(user_id);
create index if not exists inventory_items_created_at_idx
  on public.inventory_items(created_at desc);

alter table public.inventory_items enable row level security;

drop policy if exists "Users can read their own inventory" on public.inventory_items;
create policy "Users can read their own inventory"
  on public.inventory_items for select
  to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "Users can add their own inventory" on public.inventory_items;
create policy "Users can add their own inventory"
  on public.inventory_items for insert
  to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own inventory" on public.inventory_items;
create policy "Users can update their own inventory"
  on public.inventory_items for update
  to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete their own inventory" on public.inventory_items;
create policy "Users can delete their own inventory"
  on public.inventory_items for delete
  to authenticated using ((select auth.uid()) = user_id);

create or replace function public.set_inventory_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists inventory_items_updated_at on public.inventory_items;
create trigger inventory_items_updated_at
before update on public.inventory_items
for each row execute procedure public.set_inventory_updated_at();
