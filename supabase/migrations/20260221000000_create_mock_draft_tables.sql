-- Create mock draft tables for Phase 1: Solo vs AI

-- mock_drafts: stores draft session settings and state
CREATE TABLE public.mock_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  draft_type TEXT NOT NULL DEFAULT 'redraft',
  scoring_type TEXT NOT NULL DEFAULT 'ppr',
  num_teams INT NOT NULL DEFAULT 12,
  num_rounds INT NOT NULL DEFAULT 15,
  pick_timer_seconds INT NOT NULL DEFAULT 0,
  user_seat INT NOT NULL DEFAULT 1,
  current_pick INT NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

-- mock_draft_picks: individual picks within a draft
CREATE TABLE public.mock_draft_picks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id UUID NOT NULL REFERENCES public.mock_drafts(id) ON DELETE CASCADE,
  pick_number INT NOT NULL,
  round INT NOT NULL,
  pick_in_round INT NOT NULL,
  seat_number INT NOT NULL,
  is_user BOOLEAN NOT NULL DEFAULT false,
  player_name TEXT NOT NULL,
  position TEXT NOT NULL,
  team TEXT NOT NULL,
  adp_rank INT NOT NULL,
  picked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for efficient pick lookups
CREATE INDEX idx_mock_draft_picks_draft_pick ON public.mock_draft_picks(draft_id, pick_number);

-- Index for user's drafts
CREATE INDEX idx_mock_drafts_user ON public.mock_drafts(user_id);

-- RLS
ALTER TABLE public.mock_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mock_draft_picks ENABLE ROW LEVEL SECURITY;

-- mock_drafts: users can CRUD their own drafts
CREATE POLICY "Users can view own drafts"
  ON public.mock_drafts FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own drafts"
  ON public.mock_drafts FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own drafts"
  ON public.mock_drafts FOR UPDATE
  USING (auth.uid() = user_id);

-- mock_draft_picks: users can read/write picks for their own drafts
CREATE POLICY "Users can view picks for own drafts"
  ON public.mock_draft_picks FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.mock_drafts
    WHERE public.mock_drafts.id = draft_id
    AND public.mock_drafts.user_id = auth.uid()
  ));

CREATE POLICY "Users can insert picks for own drafts"
  ON public.mock_draft_picks FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.mock_drafts
    WHERE public.mock_drafts.id = draft_id
    AND public.mock_drafts.user_id = auth.uid()
  ));
