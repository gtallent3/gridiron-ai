-- Fix enum values in settle function
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
  v_bet record;
  v_won boolean;
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

  -- Process all bets for this prop
  for v_bet in 
    select * from public.prop_bets 
    where prop_id = p_prop_id and status = 'pending'
  loop
    -- Determine if this bet won
    if (v_bet.selection = 'over' and p_actual_value > v_line) or
       (v_bet.selection = 'under' and p_actual_value <= v_line) then
      v_won := true;
    else
      v_won := false;
    end if;

    -- Update bet status using correct enum values
    update public.prop_bets
    set status = case when v_won then 'settled_won'::public.prop_status else 'settled_lost'::public.prop_status end,
        payout_amount = case when v_won then v_bet.potential_payout else 0 end,
        settled_at = now()
    where id = v_bet.id;

    -- Credit tokens for winning bets
    if v_won then
      update public.user_tokens
      set balance = balance + v_bet.potential_payout,
          lifetime_earned = lifetime_earned + v_bet.potential_payout,
          updated_at = now()
      where user_id = v_bet.user_id;

      -- Log the winning transaction
      insert into public.token_transactions (
        user_id,
        transaction_type,
        amount,
        balance_after,
        description
      )
      select 
        v_bet.user_id,
        'prop_win'::public.token_transaction_type,
        v_bet.potential_payout,
        ut.balance,
        format('Won prop bet on %s', (select player_name from public.weekly_props where id = p_prop_id))
      from public.user_tokens ut
      where ut.user_id = v_bet.user_id;
    end if;
  end loop;
end;
$$;