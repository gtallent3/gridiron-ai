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
import { AIAssistant } from "@/components/AIAssistant";
import { OffseasonBanner } from "@/components/OffseasonBanner";
import { PreseasonDashboard } from "@/components/PreseasonDashboard";
import { useSeasonState } from "@/hooks/useSeasonState";
import { SeasonState } from "@/lib/nflWeekUtils";

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
          <section className="pt-20 py-12">
            <div className="container mx-auto px-4">
              <div className="max-w-4xl mx-auto">
                {!isInSeason && <OffseasonBanner seasonState={seasonState} showBackfill />}
                <ConnectedLeagues />
              </div>
            </div>
          </section>
          {isInSeason && (
            <>
              <StartSitAnalyzer />
              <PositionalRankingsSnapshot />
            </>
          )}
          {seasonState === SeasonState.PRE_SEASON && (
            <section className="py-6">
              <div className="container mx-auto px-4">
                <div className="max-w-4xl mx-auto">
                  <PreseasonDashboard />
                </div>
              </div>
            </section>
          )}
          <section className="py-6">
            <div className="container mx-auto px-4">
              <div className="max-w-4xl mx-auto">
                <Card className="bg-gradient-to-r from-primary/10 to-accent/10 border-primary/20">
                  <CardContent className="flex items-center justify-between py-4">
                    <div>
                      <h3 className="font-semibold text-base">Mock Draft</h3>
                      <p className="text-sm text-muted-foreground">
                        Practice your draft strategy against AI opponents
                      </p>
                    </div>
                    <Button variant="hero" size="sm" onClick={() => navigate("/mock-draft")}>
                      Start Draft
                    </Button>
                  </CardContent>
                </Card>
              </div>
            </div>
          </section>
          <AIAssistant />
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
