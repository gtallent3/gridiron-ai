-- Multi-account abuse prevention system

-- Canonical user table (extends existing auth.users)
CREATE TABLE IF NOT EXISTS public.app_users (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text UNIQUE,
  phone text UNIQUE,
  stripe_customer_id text UNIQUE,
  auth_provider text,
  risk_score integer DEFAULT 0 CHECK (risk_score >= 0 AND risk_score <= 100),
  is_banned boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Linked identities (one person, many login methods)
CREATE TABLE IF NOT EXISTS public.user_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.app_users(user_id) ON DELETE CASCADE,
  provider text NOT NULL,
  provider_uid text NOT NULL,
  email text,
  phone text,
  created_at timestamptz DEFAULT now(),
  UNIQUE (provider, provider_uid)
);

-- Device fingerprints
CREATE TABLE IF NOT EXISTS public.devices (
  device_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.app_users(user_id) ON DELETE SET NULL,
  fingerprint text NOT NULL,
  ua text,
  ip_inet inet,
  first_seen timestamptz DEFAULT now(),
  last_seen timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_devices_fingerprint ON public.devices(fingerprint);
CREATE INDEX IF NOT EXISTS idx_devices_ip ON public.devices(ip_inet);
CREATE INDEX IF NOT EXISTS idx_devices_user_id ON public.devices(user_id);

-- Payment method fingerprints
CREATE TABLE IF NOT EXISTS public.payment_fingerprints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.app_users(user_id) ON DELETE CASCADE,
  fingerprint text NOT NULL,
  stripe_payment_method_id text,
  first_used timestamptz DEFAULT now(),
  last_used timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_fingerprints_fingerprint ON public.payment_fingerprints(fingerprint);
CREATE INDEX IF NOT EXISTS idx_payment_fingerprints_user_id ON public.payment_fingerprints(user_id);

-- Risk events / flags
CREATE TABLE IF NOT EXISTS public.risk_events (
  id bigserial PRIMARY KEY,
  user_id uuid REFERENCES public.app_users(user_id) ON DELETE SET NULL,
  event_type text NOT NULL,
  risk_score integer CHECK (risk_score >= 0 AND risk_score <= 100),
  reason text,
  meta jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_risk_events_user_id ON public.risk_events(user_id);
CREATE INDEX IF NOT EXISTS idx_risk_events_created_at ON public.risk_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_risk_events_risk_score ON public.risk_events(risk_score DESC);

-- Account links for merges
CREATE TABLE IF NOT EXISTS public.account_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  primary_user_id uuid REFERENCES public.app_users(user_id) ON DELETE CASCADE,
  secondary_user_id uuid REFERENCES public.app_users(user_id) ON DELETE CASCADE,
  status text CHECK (status IN ('pending','approved','rejected')) DEFAULT 'pending',
  requested_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  decided_at timestamptz,
  decided_by uuid REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS idx_account_links_primary ON public.account_links(primary_user_id);
CREATE INDEX IF NOT EXISTS idx_account_links_secondary ON public.account_links(secondary_user_id);
CREATE INDEX IF NOT EXISTS idx_account_links_status ON public.account_links(status);

-- Signup rate limiting
CREATE TABLE IF NOT EXISTS public.signup_rate_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier text NOT NULL,
  identifier_type text NOT NULL CHECK (identifier_type IN ('ip', 'fingerprint', 'email', 'phone')),
  attempt_count integer DEFAULT 1,
  window_start timestamptz DEFAULT now(),
  UNIQUE (identifier, identifier_type, window_start)
);

CREATE INDEX IF NOT EXISTS idx_signup_rate_limits_identifier ON public.signup_rate_limits(identifier, identifier_type);
CREATE INDEX IF NOT EXISTS idx_signup_rate_limits_window ON public.signup_rate_limits(window_start);

-- Enable RLS on all tables
ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_fingerprints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.risk_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.signup_rate_limits ENABLE ROW LEVEL SECURITY;

-- RLS Policies for app_users
CREATE POLICY "Users can view their own app_user record"
  ON public.app_users FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all app_users"
  ON public.app_users FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Service can manage app_users"
  ON public.app_users FOR ALL
  USING (true);

-- RLS Policies for user_identities
CREATE POLICY "Users can view their own identities"
  ON public.user_identities FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.app_users 
    WHERE app_users.user_id = user_identities.user_id 
    AND app_users.user_id = auth.uid()
  ));

CREATE POLICY "Service can manage identities"
  ON public.user_identities FOR ALL
  USING (true);

-- RLS Policies for devices
CREATE POLICY "Users can view their own devices"
  ON public.devices FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Admins can view all devices"
  ON public.devices FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Service can manage devices"
  ON public.devices FOR ALL
  USING (true);

-- RLS Policies for payment_fingerprints
CREATE POLICY "Users can view their own payment fingerprints"
  ON public.payment_fingerprints FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Service can manage payment fingerprints"
  ON public.payment_fingerprints FOR ALL
  USING (true);

-- RLS Policies for risk_events
CREATE POLICY "Admins can view all risk events"
  ON public.risk_events FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Service can manage risk events"
  ON public.risk_events FOR ALL
  USING (true);

-- RLS Policies for account_links
CREATE POLICY "Users can view their own account links"
  ON public.account_links FOR SELECT
  USING (primary_user_id = auth.uid() OR secondary_user_id = auth.uid());

CREATE POLICY "Users can request account links"
  ON public.account_links FOR INSERT
  WITH CHECK (auth.uid() = requested_by);

CREATE POLICY "Admins can manage all account links"
  ON public.account_links FOR ALL
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Service can manage account links"
  ON public.account_links FOR ALL
  USING (true);

-- RLS Policies for signup_rate_limits
CREATE POLICY "Service can manage rate limits"
  ON public.signup_rate_limits FOR ALL
  USING (true);

-- Function to normalize email (trim, lowercase, handle Gmail dots/plus)
CREATE OR REPLACE FUNCTION public.normalize_email(raw_email text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  normalized text;
  local_part text;
  domain_part text;
BEGIN
  IF raw_email IS NULL THEN
    RETURN NULL;
  END IF;
  
  -- Trim and lowercase
  normalized := lower(trim(raw_email));
  
  -- Split into local and domain
  local_part := split_part(normalized, '@', 1);
  domain_part := split_part(normalized, '@', 2);
  
  -- Gmail special handling: remove dots and ignore plus addressing
  IF domain_part IN ('gmail.com', 'googlemail.com') THEN
    local_part := replace(split_part(local_part, '+', 1), '.', '');
  END IF;
  
  RETURN local_part || '@' || domain_part;
END;
$$;

-- Function to clean up old rate limit records
CREATE OR REPLACE FUNCTION public.cleanup_old_rate_limits()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.signup_rate_limits
  WHERE window_start < now() - interval '48 hours';
END;
$$;

-- Trigger to update app_users.updated_at
CREATE OR REPLACE FUNCTION public.update_app_users_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER update_app_users_updated_at
  BEFORE UPDATE ON public.app_users
  FOR EACH ROW
  EXECUTE FUNCTION public.update_app_users_updated_at();