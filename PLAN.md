# Gridiron GM — Product Plan

## What It Is
AI-powered fantasy football assistant. Web app + native iOS/Android (Capacitor).
Live at **gridiron-gm.com** (hosted via Lovable, deploying from GitHub `main`).

---

## Infrastructure

| Thing | Status | Notes |
|---|---|---|
| Frontend | ✅ Deployed | gridiron-gm.com via Lovable hosting |
| Database | ⚠️ Needs migration | Currently on Lovable's Supabase org — no CLI access |
| Edge Functions | ❌ Broken | Lovable doesn't redeploy functions from GitHub |
| Capacitor iOS | ⚠️ Partial | Web assets sync fine, pod install needs Xcode |
| Capacitor Android | ✅ Works | Syncs cleanly |
| Stripe | ⚠️ Test mode only | Live keys exist but not activated |
| Hosting (auto-deploy) | ❌ Missing | Need Netlify/Vercel — currently must manually publish from Lovable |

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
| Mock Draft | Players fail to load (edge fn not deployed, client-side FC fetch in progress) | Migrate Supabase → deploy functions |
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
- [ ] Migrate Supabase to own account
- [ ] Deploy all edge functions via CLI
- [ ] Set up Netlify/Vercel auto-deploy
- [ ] Verify mock draft works end-to-end
- [ ] Verify AI league assistant works with new context

### Near Term
- [ ] **Live Draft Assistant** (high priority for draft season Aug/Sep)
  - Poll ESPN draft API using existing `espn_s2`/`swid` credentials to sync picks in real time
  - Implement Sleeper live draft via their websocket API (cleaner, real-time)
  - Feed live pick state into existing `draft-scoring.ts` scoring logic for AI suggestions
  - UI: companion tab that auto-updates as picks come in — no manual input needed
  - Future upgrade: browser extension overlay directly on ESPN/Sleeper draft room
- [ ] Fix AI archetype weights in `src/lib/draft-scoring.ts` — `rb_heavy`/`zero_rb`/`wr_early` weights are inverted (lower score = better pick, so "prioritize RB" needs `RB < 1.0`, not `> 1.0`). Audit all 6 archetypes after migration.
- [ ] Stripe live mode activation
- [ ] Mock draft multiplayer (friends)
- [ ] Player over/unders swipe UI (PredictIQ)
- [ ] Push notifications (pick reminders, waiver deadlines)

### Later
- [ ] Dynasty draft + trade tools
- [ ] ML score predictions
- [ ] Immaculate Grid game
- [ ] Apple Developer account + App Store submission ($99/yr)

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
