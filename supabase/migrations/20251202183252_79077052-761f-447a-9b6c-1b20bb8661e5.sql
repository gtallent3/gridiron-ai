-- Remove the dangerous UPDATE policy that allows users to manipulate their own token balance
DROP POLICY IF EXISTS "Users can update their own token balance" ON public.user_tokens;