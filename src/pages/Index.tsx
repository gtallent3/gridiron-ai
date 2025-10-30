import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Header } from "@/components/Header";
import { HeroSection } from "@/components/landing/HeroSection";
import { FeatureOverview } from "@/components/landing/FeatureOverview";
import { FreeStartSitDemo } from "@/components/landing/FreeStartSitDemo";
import { FeatureComparison } from "@/components/landing/FeatureComparison";
import { Testimonials } from "@/components/landing/Testimonials";
import { FinalCTA } from "@/components/landing/FinalCTA";
import { Footer } from "@/components/landing/Footer";
import { ConnectedLeagues } from "@/components/ConnectedLeagues";
import { StartSitAnalyzer } from "@/components/StartSitAnalyzer";
import { TradeAnalyzer } from "@/components/TradeAnalyzer";
import { AIAssistant } from "@/components/AIAssistant";

const Index = () => {
  const [user, setUser] = useState<any>(null);

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
                <ConnectedLeagues />
              </div>
            </div>
          </section>
          <StartSitAnalyzer />
          <TradeAnalyzer />
          <AIAssistant />
        </>
      ) : (
        // Landing Page for Non-Signed-In Users
        <>
          <HeroSection />
          <FeatureOverview />
          <FreeStartSitDemo />
          <FeatureComparison />
          <Testimonials />
          <FinalCTA />
        </>
      )}
      
      <Footer />
    </div>
  );
};

export default Index;
