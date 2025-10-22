-- Create a secure function to settle a weekly prop as admin
create or replace function public.settle_weekly_prop(
  p_prop_id uuid,
  p_actual_value numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line numeric;
  v_new_status public.prop_status;
begin
  -- Ensure caller is admin
  if not public.has_role(auth.uid(), 'admin'::public.app_role) then
    raise exception 'Unauthorized: admin role required';
  end if;

  -- Fetch current line
  select line into v_line from public.weekly_props where id = p_prop_id;
  if not found then
    raise exception 'Prop not found';
  end if;

  -- Determine status based on result
  if p_actual_value > v_line then
    v_new_status := 'settled_won';
  else
    v_new_status := 'settled_lost';
  end if;

  -- Update the prop
  update public.weekly_props
  set actual_value = p_actual_value,
      status = v_new_status,
      settled_at = now(),
      updated_at = now()
  where id = p_prop_id;
end;
$$;

-- Allow authenticated users to execute (function enforces admin)
grant execute on function public.settle_weekly_prop(uuid, numeric) to authenticated;