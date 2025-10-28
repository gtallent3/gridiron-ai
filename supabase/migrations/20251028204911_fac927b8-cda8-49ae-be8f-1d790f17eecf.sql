-- Extend app_users for subscription management
ALTER TABLE public.app_users
  ADD COLUMN IF NOT EXISTS current_plan text,
  ADD COLUMN IF NOT EXISTS sub_status text,
  ADD COLUMN IF NOT EXISTS cancel_at timestamptz,
  ADD COLUMN IF NOT EXISTS period_end timestamptz,
  ADD COLUMN IF NOT EXISTS renewed_at timestamptz;

-- Create subscriptions table
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.app_users(user_id) ON DELETE CASCADE,
  stripe_subscription_id text UNIQUE NOT NULL,
  plan_id text NOT NULL,
  status text NOT NULL,
  cancel_at_period_end boolean DEFAULT false,
  current_period_start timestamptz,
  current_period_end timestamptz,
  trial_end timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON public.subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_id ON public.subscriptions(stripe_subscription_id);

-- Create invoices table
CREATE TABLE IF NOT EXISTS public.invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.app_users(user_id) ON DELETE CASCADE,
  stripe_invoice_id text UNIQUE NOT NULL,
  amount_due integer NOT NULL,
  amount_paid integer NOT NULL,
  currency text DEFAULT 'usd',
  status text NOT NULL,
  hosted_invoice_url text,
  invoice_pdf text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invoices_user_id ON public.invoices(user_id);
CREATE INDEX IF NOT EXISTS idx_invoices_created_at ON public.invoices(created_at DESC);

-- Enable RLS
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;

-- RLS Policies for subscriptions
CREATE POLICY "Users can view their own subscriptions"
  ON public.subscriptions FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.app_users 
    WHERE app_users.user_id = subscriptions.user_id 
    AND app_users.user_id = auth.uid()
  ));

CREATE POLICY "Service can manage subscriptions"
  ON public.subscriptions FOR ALL
  USING (true);

-- RLS Policies for invoices
CREATE POLICY "Users can view their own invoices"
  ON public.invoices FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.app_users 
    WHERE app_users.user_id = invoices.user_id 
    AND app_users.user_id = auth.uid()
  ));

CREATE POLICY "Admins can view all invoices"
  ON public.invoices FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Service can manage invoices"
  ON public.invoices FOR ALL
  USING (true);

-- Trigger to update subscriptions updated_at
CREATE OR REPLACE FUNCTION public.update_subscriptions_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER update_subscriptions_updated_at
  BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_subscriptions_updated_at();