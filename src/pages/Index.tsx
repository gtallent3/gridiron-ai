import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Header } from "@/components/Header";
import { HeroSection } from "@/components/landing/HeroSection";
import { FeatureOverview } from "@/components/landing/FeatureOverview";
import { FreeStartSitDemo } from "@/components/landing/FreeStartSitDemo";
import { FeatureComparison } from "@/components/landing/FeatureComparison";
import { FinalCTA } from "@/components/landing/FinalCTA";
import { Footer } from "@/components/landing/Footer";
import { ConnectedLeagues } from "@/components/ConnectedLeagues";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { StartSitAnalyzer } from "@/components/StartSitAnalyzer";
import { PositionalRankingsSnapshot } from "@/components/PositionalRankingsSnapshot";
import { OffseasonBanner } from "@/components/OffseasonBanner";
import { PreseasonDashboard } from "@/components/PreseasonDashboard";
import { useSeasonState } from "@/hooks/useSeasonState";
import { SeasonState } from "@/lib/nflWeekUtils";
import { ClipboardList, BarChart3, Users } from "lucide-react";

const Index = () => {
  const [user, setUser] = useState<any>(null);
  const { seasonState, isInSeason } = useSeasonState();
  const navigate = useNavigate();

  useEffect(() => {
    // Check current session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <Header user={user} />

      {user ? (
        // Signed-in User Experience
        <>
          <section className="pt-20 py-8">
            <div className="container mx-auto px-4">
              <div className="max-w-4xl mx-auto space-y-5">

                {/* Season state banner */}
                {!isInSeason && <OffseasonBanner seasonState={seasonState} showBackfill />}

                {/* OFFSEASON: Mock Draft as the hero */}
                {(seasonState === SeasonState.OFFSEASON || seasonState === SeasonState.PRE_SEASON || seasonState === SeasonState.POSTSEASON) && (
                  <Card className="bg-gradient-to-r from-primary/20 to-accent/20 border-primary/30">
                    <CardContent className="py-6">
                      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <ClipboardList className="h-5 w-5 text-primary" />
                            <h2 className="text-xl font-bold">Mock Draft</h2>
                          </div>
                          <p className="text-sm text-muted-foreground">
                            Build your board and practice against AI opponents. Redraft or dynasty.
                          </p>
                        </div>
                        <Button variant="hero" onClick={() => navigate("/mock-draft")} className="shrink-0">
                          Start Mock Draft
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* OFFSEASON: Draft prep quick links */}
                {(seasonState === SeasonState.OFFSEASON || seasonState === SeasonState.PRE_SEASON) && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Card className="hover:border-primary/40 transition-colors cursor-pointer" onClick={() => navigate("/player-rankings")}>
                      <CardContent className="flex items-center gap-4 py-4">
                        <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                          <BarChart3 className="h-5 w-5 text-primary" />
                        </div>
                        <div>
                          <h3 className="font-semibold text-sm">Player Rankings</h3>
                          <p className="text-xs text-muted-foreground">ADP, trade values & positional tiers</p>
                        </div>
                      </CardContent>
                    </Card>
                    <Card className="hover:border-primary/40 transition-colors cursor-pointer" onClick={() => navigate("/connect-league")}>
                      <CardContent className="flex items-center gap-4 py-4">
                        <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                          <Users className="h-5 w-5 text-primary" />
                        </div>
                        <div>
                          <h3 className="font-semibold text-sm">Connect a League</h3>
                          <p className="text-xs text-muted-foreground">Import your ESPN, Sleeper or Yahoo league</p>
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                )}

                {/* Connected leagues (season recap links in offseason) */}
                <ConnectedLeagues />

              </div>
            </div>
          </section>

          {/* IN-SEASON features */}
          {isInSeason && (
            <>
              <StartSitAnalyzer />
              <PositionalRankingsSnapshot />
            </>
          )}

          {/* PRE-SEASON dashboard */}
          {seasonState === SeasonState.PRE_SEASON && (
            <section className="py-6">
              <div className="container mx-auto px-4">
                <div className="max-w-4xl mx-auto">
                  <PreseasonDashboard />
                </div>
              </div>
            </section>
          )}
        </>
      ) : (
        // Landing Page for Non-Signed-In Users
        <>
          <HeroSection />
          <FeatureOverview />
          <FreeStartSitDemo />
          <FeatureComparison />
          <FinalCTA />
        </>
      )}

      <Footer />
    </div>
  );
};

export default Index;
