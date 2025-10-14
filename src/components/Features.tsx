import { Brain, TrendingUp, Users, Zap, Shield, BarChart3 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";

const features = [
  {
    icon: Brain,
    title: "AI Start/Sit",
    description: "Get instant recommendations powered by advanced machine learning analyzing thousands of data points.",
  },
  {
    icon: TrendingUp,
    title: "Trade Analyzer",
    description: "Evaluate trades with AI-powered fairness scores, value projections, and win probability analysis.",
  },
  {
    icon: BarChart3,
    title: "Player Comparison",
    description: "Compare players side-by-side with detailed stats, matchup grades, and consistency scores.",
  },
  {
    icon: Users,
    title: "Waiver Wire AI",
    description: "Get personalized waiver wire recommendations based on your roster needs and schedule.",
  },
  {
    icon: Shield,
    title: "Injury Updates",
    description: "Real-time injury reports and news feed that automatically adjusts your recommendations.",
  },
  {
    icon: Zap,
    title: "24/7 AI Assistant",
    description: "Chat with our AI for instant answers about lineup decisions, player analysis, and more.",
  },
];

export const Features = () => {
  return (
    <section className="py-20 relative">
      <div className="container mx-auto px-4">
        <div className="max-w-6xl mx-auto space-y-12">
          {/* Section Header */}
          <div className="text-center space-y-4">
            <h2 className="text-4xl font-bold">Powerful AI Features</h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
              Everything you need to dominate your fantasy league, powered by cutting-edge AI technology
            </p>
          </div>

          {/* Features Grid */}
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((feature, index) => {
              const Icon = feature.icon;
              return (
                <Card
                  key={index}
                  className="border-border/50 bg-card/50 backdrop-blur-sm hover:border-primary/50 transition-all duration-300 hover:shadow-[0_0_30px_hsl(var(--glow-primary)/0.15)] group"
                >
                  <CardHeader>
                    <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center mb-4 group-hover:bg-primary/20 transition-colors group-hover:shadow-[0_0_20px_hsl(var(--glow-primary)/0.3)]">
                      <Icon className="h-6 w-6 text-primary" />
                    </div>
                    <CardTitle className="text-xl">{feature.title}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <CardDescription className="text-base leading-relaxed">
                      {feature.description}
                    </CardDescription>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
};
