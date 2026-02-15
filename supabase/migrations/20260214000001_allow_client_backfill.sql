-- Allow authenticated users to insert/upsert into actual_weekly_points
-- so the client-side backfill can work without edge functions
CREATE POLICY "Authenticated users can insert actual weekly points"
  ON public.actual_weekly_points
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update actual weekly points"
  ON public.actual_weekly_points
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);
