-- Add admin SELECT policies for user_tokens table
CREATE POLICY "Admins can view all user tokens"
  ON public.user_tokens FOR SELECT
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Add admin SELECT policy for token_transactions table
CREATE POLICY "Admins can view all transactions"
  ON public.token_transactions FOR SELECT
  USING (has_role(auth.uid(), 'admin'::app_role));