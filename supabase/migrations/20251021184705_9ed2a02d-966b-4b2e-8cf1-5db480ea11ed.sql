-- Create enum for transaction types
CREATE TYPE public.token_transaction_type AS ENUM (
  'purchase',
  'signup_bonus',
  'weekly_reward',
  'ai_assistant',
  'start_sit',
  'trade_analysis',
  'prop_bet',
  'prop_win',
  'admin_adjustment',
  'subscription'
);

-- Create enum for prop bet status
CREATE TYPE public.prop_status AS ENUM (
  'pending',
  'active',
  'settled_won',
  'settled_lost',
  'cancelled'
);

-- Create enum for prop stat types
CREATE TYPE public.prop_stat_type AS ENUM (
  'passing_yards',
  'rushing_yards',
  'receiving_yards',
  'touchdowns',
  'receptions',
  'fantasy_points'
);

-- Create user_tokens table
CREATE TABLE public.user_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  balance INTEGER NOT NULL DEFAULT 3,
  lifetime_purchased INTEGER NOT NULL DEFAULT 0,
  lifetime_earned INTEGER NOT NULL DEFAULT 3,
  lifetime_spent INTEGER NOT NULL DEFAULT 0,
  last_weekly_reward_at TIMESTAMP WITH TIME ZONE,
  has_unlimited_subscription BOOLEAN NOT NULL DEFAULT false,
  subscription_expires_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT balance_non_negative CHECK (balance >= 0)
);

-- Create token_transactions table
CREATE TABLE public.token_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  transaction_type token_transaction_type NOT NULL,
  amount INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  description TEXT,
  metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create token_packages table
CREATE TABLE public.token_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  tokens INTEGER NOT NULL,
  price_cents INTEGER NOT NULL,
  bonus_percentage INTEGER NOT NULL DEFAULT 0,
  stripe_price_id TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create weekly_props table
CREATE TABLE public.weekly_props (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  week INTEGER NOT NULL,
  season INTEGER NOT NULL,
  player_id TEXT NOT NULL,
  player_name TEXT NOT NULL,
  team TEXT NOT NULL,
  opponent TEXT,
  stat_type prop_stat_type NOT NULL,
  line NUMERIC(10,2) NOT NULL,
  over_multiplier NUMERIC(4,2) NOT NULL DEFAULT 2.0,
  under_multiplier NUMERIC(4,2) NOT NULL DEFAULT 2.0,
  actual_value NUMERIC(10,2),
  status prop_status NOT NULL DEFAULT 'pending',
  game_time TIMESTAMP WITH TIME ZONE,
  settled_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(week, season, player_id, stat_type)
);

-- Create prop_bets table
CREATE TABLE public.prop_bets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  prop_id UUID NOT NULL REFERENCES weekly_props(id) ON DELETE CASCADE,
  tokens_wagered INTEGER NOT NULL,
  selection TEXT NOT NULL CHECK (selection IN ('over', 'under')),
  multiplier NUMERIC(4,2) NOT NULL,
  potential_payout INTEGER NOT NULL,
  status prop_status NOT NULL DEFAULT 'pending',
  payout_amount INTEGER,
  settled_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT tokens_wagered_positive CHECK (tokens_wagered > 0)
);

-- Create indexes
CREATE INDEX idx_token_transactions_user_id ON public.token_transactions(user_id);
CREATE INDEX idx_token_transactions_created_at ON public.token_transactions(created_at DESC);
CREATE INDEX idx_weekly_props_week_season ON public.weekly_props(week, season);
CREATE INDEX idx_weekly_props_status ON public.weekly_props(status);
CREATE INDEX idx_prop_bets_user_id ON public.prop_bets(user_id);
CREATE INDEX idx_prop_bets_prop_id ON public.prop_bets(prop_id);
CREATE INDEX idx_prop_bets_status ON public.prop_bets(status);

-- Enable RLS
ALTER TABLE public.user_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.token_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.token_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.weekly_props ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prop_bets ENABLE ROW LEVEL SECURITY;

-- RLS Policies for user_tokens
CREATE POLICY "Users can view their own token balance"
  ON public.user_tokens FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own token balance"
  ON public.user_tokens FOR UPDATE
  USING (auth.uid() = user_id);

-- RLS Policies for token_transactions
CREATE POLICY "Users can view their own transactions"
  ON public.token_transactions FOR SELECT
  USING (auth.uid() = user_id);

-- RLS Policies for token_packages
CREATE POLICY "Anyone can view active token packages"
  ON public.token_packages FOR SELECT
  USING (is_active = true);

-- RLS Policies for weekly_props
CREATE POLICY "Anyone can view active props"
  ON public.weekly_props FOR SELECT
  USING (status IN ('pending', 'active'));

-- RLS Policies for prop_bets
CREATE POLICY "Users can view their own bets"
  ON public.prop_bets FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own bets"
  ON public.prop_bets FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for updated_at
CREATE TRIGGER update_user_tokens_updated_at
  BEFORE UPDATE ON public.user_tokens
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_token_packages_updated_at
  BEFORE UPDATE ON public.token_packages
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_weekly_props_updated_at
  BEFORE UPDATE ON public.weekly_props
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Trigger to create token balance on user signup
CREATE OR REPLACE FUNCTION public.handle_new_user_tokens()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_tokens (user_id, balance, lifetime_earned)
  VALUES (NEW.id, 3, 3);
  
  INSERT INTO public.token_transactions (
    user_id,
    transaction_type,
    amount,
    balance_after,
    description
  ) VALUES (
    NEW.id,
    'signup_bonus',
    3,
    3,
    'Welcome bonus - 3 free tokens'
  );
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER on_auth_user_created_tokens
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_tokens();

-- Insert default token packages
INSERT INTO public.token_packages (name, tokens, price_cents, bonus_percentage, display_order) VALUES
  ('Starter Pack', 10, 999, 0, 1),
  ('Value Pack', 22, 1999, 10, 2);

-- Function to deduct tokens (used by edge functions)
CREATE OR REPLACE FUNCTION public.deduct_tokens(
  p_user_id UUID,
  p_amount INTEGER,
  p_transaction_type token_transaction_type,
  p_description TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_current_balance INTEGER;
  v_new_balance INTEGER;
  v_has_unlimited BOOLEAN;
BEGIN
  -- Check if user has unlimited subscription
  SELECT has_unlimited_subscription INTO v_has_unlimited
  FROM public.user_tokens
  WHERE user_id = p_user_id;
  
  -- If unlimited and subscription is active, allow without deducting
  IF v_has_unlimited AND EXISTS (
    SELECT 1 FROM public.user_tokens
    WHERE user_id = p_user_id
    AND subscription_expires_at > now()
  ) THEN
    RETURN jsonb_build_object(
      'success', true,
      'balance', -1,
      'unlimited', true
    );
  END IF;
  
  -- Get current balance
  SELECT balance INTO v_current_balance
  FROM public.user_tokens
  WHERE user_id = p_user_id;
  
  IF v_current_balance IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'User tokens not found');
  END IF;
  
  IF v_current_balance < p_amount THEN
    RETURN jsonb_build_object('success', false, 'error', 'Insufficient tokens');
  END IF;
  
  -- Deduct tokens
  v_new_balance := v_current_balance - p_amount;
  
  UPDATE public.user_tokens
  SET balance = v_new_balance,
      lifetime_spent = lifetime_spent + p_amount,
      updated_at = now()
  WHERE user_id = p_user_id;
  
  -- Log transaction
  INSERT INTO public.token_transactions (
    user_id,
    transaction_type,
    amount,
    balance_after,
    description
  ) VALUES (
    p_user_id,
    p_transaction_type,
    -p_amount,
    v_new_balance,
    COALESCE(p_description, 'Token spent on ' || p_transaction_type::text)
  );
  
  RETURN jsonb_build_object(
    'success', true,
    'balance', v_new_balance,
    'unlimited', false
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;