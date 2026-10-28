create or replace function price_for_units(p_units integer) returns integer language sql immutable as $$
  select 1000 + greatest(0, p_units - 20) * 25
$$;
