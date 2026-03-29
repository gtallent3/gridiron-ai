# Gridiron GM — Product Plan

## What It Is
AI-powered fantasy football assistant. Web app + native iOS/Android (Capacitor).
Live at **gridiron-gm.com** (hosted via Lovable, deploying from GitHub `main`).

---

## Infrastructure

| Thing | Status | Notes |
|---|---|---|
| Frontend | ✅ Deployed | gridiron-gm.com via Lovable hosting |
| Database | ✅ Migrated | Own Supabase org (uzmhgxxqstyqzcfclwqr), full CLI access |
| Edge Functions | ✅ Deployed | All 65 functions live on new Supabase project |
| Capacitor iOS | ⚠️ Partial | Web assets sync fine, pod install needs Xcode |
| Capacitor Android | ✅ Works | Syncs cleanly |
| Stripe | ⚠️ Test mode only | Live keys exist but not activated |
| Hosting (auto-deploy) | ✅ Live | Vercel auto-deploys on every push to main, gridiron-gm.com connected |

### Immediate Infrastructure TODO
- [ ] **Migrate Supabase** to `gtallent3's Org` (new project, full CLI access)
  - `supabase link` → `supabase db push` → `supabase functions deploy --all`
  - Set secrets: `ANTHROPIC_API_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
  - No data migration needed — re-ingest from Admin panel
- [ ] **Set up Netlify or Vercel** — auto-deploy on every GitHub push to `main`
- [ ] **Activate Stripe live mode** — complete business verification, link bank account

---

## Core Features

### ✅ Working
| Feature | Notes |
|---|---|
| Auth (login/signup) | Supabase auth |
| Connect League | Sleeper, ESPN, Yahoo |
| League Dashboard | Roster, matchup, standings |
| Trade Evaluator | Multi-version (v1, v2, v3) |
| Player Rankings | PPG, SOS, trade value, search, sort |
| Season Recap | Weekly chart, top performers, positional breakdown |
| Waiver Wire Analysis | AI-powered suggestions |
| Lineup Optimizer | Start/sit analysis |
| Token Shop | Stripe checkout, subscription tiers |
| Admin Panel | Data pipeline, user management, props |
| PredictIQ | Player prop predictions |

### ⚠️ Partially Working
| Feature | Issue | Fix |
|---|---|---|
| Mock Draft | ⚠️ Functional but needs polish | Players load from trade_values, AI suggestions working, UX improvements needed |
| League AI Assistant | Context is thin — no injury status, opponent roster, recent form | Context was improved this session (needs edge fn deployed to reflect) |
| General AI Chat | Stale, not league-aware | Acceptable for now |
| Season Recap backfill | Works but slow (client-side Sleeper fetch) | Move to edge function post-migration |

### ❌ Not Built Yet
| Feature | Priority | Notes |
|---|---|---|
| Mock Draft multiplayer (with friends) | High | Tables exist, no real-time layer yet |
| Dynasty draft mode | Medium | Setup UI exists, no dynasty player pool |
| Auto-deploy pipeline | High | Netlify/Vercel |
| Player over/unders (TikTok-style) | Medium | PredictIQ page exists, needs swipe UI |
| ML score predictions | Low | Need Python service, data exists in `actual_weekly_points` |
| Immaculate Grid game | Low | Virality/engagement feature |
| Keeper/dynasty analysis | Medium | Offseason tool |
| Schedule data (2026) | High (preseason) | Re-run `ingest-team-schedules` each year |

---

## Mock Draft Specifically

**Player loading fallback chain (current):**
1. `trade_values` table (FantasyCalc data — empty until ingest runs)
2. Direct fetch to `api.fantasycalc.com` (client-side, CORS-enabled, ~50KB)
3. Error

**After Supabase migration:**
1. `trade_values` (populated via Admin → Data Pipeline → "Fetch Draft Rankings")
2. `get-draft-players` edge function (FantasyCalc server-side)
3. Direct FantasyCalc fetch (client-side fallback)

**Mock Draft features built:**
- AI pick recommendations (top 3 with plain-English reasoning)
- Roster need indicators (need/full per position)
- Snake draft engine with timer
- AI opponents (position-aware scoring)
- Board auto-scroll
- Results page
- Resume from saved state

---

## Data Pipeline (Admin Panel → Data Pipeline tab)

Run in this order each season:

| Step | Function | Frequency |
|---|---|---|
| 0 | **Fetch Draft Rankings** (FantasyCalc) | Once/offseason |
| 1 | Fetch Sleeper Projections | Weekly |
| 1 | Ingest Sleeper Players | Season start |
| 1 | Fetch NFL Stats | Weekly |
| 1 | Ingest Injuries | Weekly |
| 1 | Ingest Player Stats | Weekly |
| 1 | Ingest Snap Counts | Weekly |
| 2 | Map Canonical Players | After Step 1 |
| 3 | Compute Player Pool | After Step 2 |
| 4 | Compute Rankings | After Step 3 |
| 4 | Compute Trade Values | After Step 3 |
| 4 | Compute Team SOS | After schedule ingest |

---

## Backlog (Prioritized)

### This Week
- [x] Migrate Supabase to own account
- [x] Deploy all edge functions via CLI
- [x] Verify mock draft works end-to-end
- [x] Set up Netlify/Vercel auto-deploy
- [ ] Verify AI league assistant works with new context

### Near Term
- [ ] **Live Draft Assistant** (high priority for draft season Aug/Sep)
  - Poll ESPN draft API using existing `espn_s2`/`swid` credentials to sync picks in real time
  - Implement Sleeper live draft via their websocket API (cleaner, real-time)
  - Feed live pick state into existing `draft-scoring.ts` scoring logic for AI suggestions
  - UI: companion tab that auto-updates as picks come in — no manual input needed
  - Future upgrade: browser extension overlay directly on ESPN/Sleeper draft room
- [ ] **Mock draft AI planning session** — archetype weights fixed (additive scoring), but overall AI draft strategy needs a dedicated design session. Known issues: too many TE/RB in early rounds, round 2 RB pile-up, run detection penalty needs tuning. Needs full rethink of VOR weights, archetype diversity, and positional balance.
- [ ] Stripe live mode activation
- [ ] Mock draft multiplayer (friends)
- [ ] Player over/unders swipe UI (PredictIQ)
- [ ] Push notifications (pick reminders, waiver deadlines)

### Admin Dashboard Improvements
- [ ] **Automated scheduling via pg_cron** — weekly functions (injuries, stats, projections, snap counts) run automatically, no manual trigger needed
- [ ] **Run history table** — add `function_run_log` (function name, ran_at, status, rows_affected, duration); display "Last run: Tue 9am — 312 rows" on each function card
- [ ] **Status indicators** — green/yellow/red dot per function (green = ran in expected window, yellow = ran with errors/low rows, red = stale/overdue)
- [ ] **One-click weekly pipeline** — single "Run Weekly Pipeline" button fires all 5 weekly functions in sequence with a progress indicator
- [ ] **Group functions by frequency** — Daily / Weekly / Seasonal / One-time sections so it's clear what needs attention and when

### Later
- [ ] Dynasty draft + trade tools
- [ ] ML score predictions
- [ ] Immaculate Grid game
- [ ] **Apple Developer account + TestFlight beta** ($99/yr)
  - Sign up at developer.apple.com
  - Install Xcode on a Mac with full Xcode (not just Command Line Tools)
  - Build and archive the Capacitor iOS app
  - Upload to App Store Connect → distribute via TestFlight
  - Invite friends as internal/external testers by email
  - Goal: get friends testing before full App Store submission

---

## Key Files

| File | Purpose |
|---|---|
| `src/hooks/useMockDraft.ts` | Mock draft engine (player loading, AI picks, timer) |
| `src/pages/MockDraftRoom.tsx` | Draft room UI |
| `src/components/mock-draft/DraftRecommendations.tsx` | AI pick suggestions |
| `src/pages/Admin.tsx` | Full admin panel |
| `src/pages/PlayerRankings.tsx` | Rankings table |
| `supabase/functions/fantasy-ai-chat/` | League AI assistant |
| `supabase/functions/get-draft-players/` | Draft player fetch (needs deploy) |
| `supabase/functions/ingest-fantasycalc/` | Populate trade_values |
| `capacitor.config.ts` | Native app config (loads gridiron-gm.com) |
| `PLAN.md` | This file |
