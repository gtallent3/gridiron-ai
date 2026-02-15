-- Fix 1: app_users — replace overly permissive "Service can manage" policy
-- The original policy used USING(true) with no TO clause, exposing all
-- user data (emails, phone numbers, Stripe IDs) to any role including anon.
DROP POLICY IF EXISTS "Service can manage app_users" ON public.app_users;

-- Service role only: full access for server-side operations (signup trigger, etc.)
CREATE POLICY "Service role can manage app_users"
  ON public.app_users FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Users can update their own record (display name, preferences, etc.)
CREATE POLICY "Users can update their own app_user record"
  ON public.app_users FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);


-- Fix 2: actual_weekly_points — add validation constraints
-- Replace wide-open INSERT/UPDATE with bounded checks on season and week.
DROP POLICY IF EXISTS "Authenticated users can insert actual weekly points" ON public.actual_weekly_points;
DROP POLICY IF EXISTS "Authenticated users can update actual weekly points" ON public.actual_weekly_points;

CREATE POLICY "Authenticated users can insert actual weekly points"
  ON public.actual_weekly_points
  FOR INSERT
  TO authenticated
  WITH CHECK (
    season >= 2020 AND season <= (EXTRACT(YEAR FROM now()) + 1)::int
    AND week >= 1 AND week <= 18
  );

CREATE POLICY "Authenticated users can update actual weekly points"
  ON public.actual_weekly_points
  FOR UPDATE
  TO authenticated
  USING (
    season >= 2020 AND season <= (EXTRACT(YEAR FROM now()) + 1)::int
    AND week >= 1 AND week <= 18
  )
  WITH CHECK (
    season >= 2020 AND season <= (EXTRACT(YEAR FROM now()) + 1)::int
    AND week >= 1 AND week <= 18
  );
