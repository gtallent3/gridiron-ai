-- Allow admins to update prop bets when settling props
CREATE POLICY "Admins can update prop bets"
ON public.prop_bets
FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));