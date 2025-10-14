import { Header } from "@/components/Header";
import { Hero } from "@/components/Hero";
import { Features } from "@/components/Features";
import { StartSitAnalyzer } from "@/components/StartSitAnalyzer";
import { TradeAnalyzer } from "@/components/TradeAnalyzer";
import { AIAssistant } from "@/components/AIAssistant";

const Index = () => {
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <Hero />
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
