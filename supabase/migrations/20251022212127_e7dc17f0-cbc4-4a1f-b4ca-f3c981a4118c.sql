DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'weekly_props' AND policyname = 'Users can view props they''ve bet on'
  ) THEN
    CREATE POLICY "Users can view props they've bet on"
    ON public.weekly_props
    FOR SELECT
    USING (
      EXISTS (
        SELECT 1 FROM public.prop_bets
        WHERE prop_bets.prop_id = weekly_props.id
          AND prop_bets.user_id = auth.uid()
      )
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'weekly_props' AND policyname = 'Admins can view all weekly props'
  ) THEN
    CREATE POLICY "Admins can view all weekly props"
    ON public.weekly_props
    FOR SELECT
    USING (public.has_role(auth.uid(), 'admin'::public.app_role));
  END IF;
END $$;