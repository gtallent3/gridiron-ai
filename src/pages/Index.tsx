import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Header } from "@/components/Header";
import { Hero } from "@/components/Hero";
import { Features } from "@/components/Features";
import { StartSitAnalyzer } from "@/components/StartSitAnalyzer";
import { TradeAnalyzer } from "@/components/TradeAnalyzer";
import { AIAssistant } from "@/components/AIAssistant";
import { ConnectedLeagues } from "@/components/ConnectedLeagues";

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
      <Hero />
      
      {/* Connected Leagues Section - Only show if logged in */}
      {user && (
        <section className="py-20">
          <div className="container mx-auto px-4">
            <div className="max-w-4xl mx-auto">
              <ConnectedLeagues />
            </div>
          </div>
        </section>
      )}

      <Features />
      <StartSitAnalyzer />
      <TradeAnalyzer />
      <AIAssistant />
      
      {/* Footer */}
      <footer className="border-t border-border/50 py-12 mt-20">
        <div className="container mx-auto px-4">
          <div className="text-center space-y-4">
            <h3 className="text-xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
              Fantasy AI
            </h3>
            <p className="text-sm text-muted-foreground">
              Dominate your fantasy football league with AI-powered insights
            </p>
            <p className="text-xs text-muted-foreground/60">
              © 2025 Fantasy AI. All rights reserved.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Index;
