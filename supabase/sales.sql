-- Gratitude Technologies Inventory: sales + discounts
-- Run this once in Supabase Dashboard > SQL Editor (after schema.sql).

create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  item_id uuid references public.inventory_items(id) on delete set null,
  item_name text not null,
  quantity integer not null check (quantity > 0),
  unit_price numeric(12,2) not null check (unit_price >= 0),
  discount_type text not null default 'none' check (discount_type in ('none','percent','amount')),
  discount_value numeric(12,2) not null default 0 check (discount_value >= 0),
  discount_amount numeric(12,2) not null default 0 check (discount_amount >= 0),
  total numeric(12,2) not null check (total >= 0),
  created_at timestamptz not null default now()
);

create index if not exists sales_user_id_idx on public.sales(user_id);
create index if not exists sales_created_at_idx on public.sales(created_at desc);

alter table public.sales enable row level security;

drop policy if exists "Users can read their own sales" on public.sales;
create policy "Users can read their own sales"
  on public.sales for select
  to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "Users can add their own sales" on public.sales;
create policy "Users can add their own sales"
  on public.sales for insert
  to authenticated with check ((select auth.uid()) = user_id);

-- Records a sale in one step: checks stock, lowers the quantity, saves the sale.
-- Runs as the signed-in user, so row-level security still applies.
create or replace function public.record_sale(
  p_item_id uuid,
  p_quantity integer,
  p_discount_type text default 'none',
  p_discount_value numeric default 0
)
returns public.sales
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_item public.inventory_items;
  v_subtotal numeric(12,2);
  v_discount numeric(12,2);
  v_value numeric(12,2) := coalesce(p_discount_value, 0);
  v_sale public.sales;
begin
  if p_quantity is null or p_quantity < 1 then
    raise exception 'Quantity must be at least 1';
  end if;
  if p_discount_type not in ('none','percent','amount') then
    raise exception 'Invalid discount type';
  end if;
  if v_value < 0 then
    raise exception 'Discount cannot be negative';
  end if;

  -- Lock the row so two sales at once can't sell the same stock twice
  select * into v_item from public.inventory_items where id = p_item_id for update;
  if not found then
    raise exception 'Item not found';
  end if;
  if v_item.quantity < p_quantity then
    raise exception 'Only % in stock', v_item.quantity;
  end if;

  v_subtotal := round(v_item.unit_price * p_quantity, 2);

  if p_discount_type = 'percent' then
    if v_value > 100 then raise exception 'Percent discount cannot be above 100'; end if;
    v_discount := round(v_subtotal * v_value / 100, 2);
  elsif p_discount_type = 'amount' then
    if v_value > v_subtotal then raise exception 'Discount is more than the sale total'; end if;
    v_discount := round(v_value, 2);
  else
    v_discount := 0;
    v_value := 0;
  end if;

  update public.inventory_items set quantity = quantity - p_quantity where id = p_item_id;

  insert into public.sales (user_id, item_id, item_name, quantity, unit_price,
                            discount_type, discount_value, discount_amount, total)
  values (auth.uid(), v_item.id, v_item.name, p_quantity, v_item.unit_price,
          p_discount_type, v_value, v_discount, v_subtotal - v_discount)
  returning * into v_sale;

  return v_sale;
end;
$$;

grant execute on function public.record_sale(uuid, integer, text, numeric) to authenticated;
