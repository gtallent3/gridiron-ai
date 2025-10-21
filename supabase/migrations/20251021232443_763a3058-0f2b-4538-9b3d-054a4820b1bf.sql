-- Remove signup bonus - users start at 0 tokens
DROP FUNCTION IF EXISTS public.handle_new_user_tokens() CASCADE;

CREATE OR REPLACE FUNCTION public.handle_new_user_tokens()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.user_tokens (user_id, balance, lifetime_earned)
  VALUES (NEW.id, 0, 0);
  
  RETURN NEW;
END;
$function$;

-- Recreate the trigger
CREATE TRIGGER on_auth_user_created_tokens
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_tokens();