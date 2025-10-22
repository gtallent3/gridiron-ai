-- Drop the existing policy
DROP POLICY IF EXISTS "Users can view their own bets" ON public.prop_bets;

-- Create a new policy that allows users to view ALL their bets (pending and settled)
CREATE POLICY "Users can view all their own bets" 
ON public.prop_bets 
FOR SELECT 
USING (auth.uid() = user_id);

-- Also ensure admins can view all bets for the admin panel
CREATE POLICY "Admins can view all bets" 
ON public.prop_bets 
FOR SELECT 
USING (has_role(auth.uid(), 'admin'::app_role));