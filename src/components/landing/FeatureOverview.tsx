import { Brain, TrendingUp, Zap, Trophy } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";

const features = [
  {
    icon: Brain,
    title: "AI Assistant",
    description: "Ask start/sit or trade questions and get instant AI-powered answers.",
    redirect: "/auth",
  },
  {
    icon: Zap,
    title: "Start/Sit Analyzer",
    description: "Compare players using real projections and scoring settings.",
    redirect: "/auth?redirect=/start-sit",
  },
  {
    icon: TrendingUp,
    title: "Trade Analyzer",
    description: "Find out who wins every deal with AI-powered trade evaluation.",
    redirect: "/auth?redirect=/trade",
  },
  {
    icon: Trophy,
    title: "Props & Tokens",
    description: "Play weekly props, earn tokens, and compete on the leaderboard.",
    redirect: "/auth?redirect=/props",
  },
];

export const FeatureOverview = () => {
  const navigate = useNavigate();

  return (
    <section id="features" className="py-20 relative scroll-mt-20">
      <div className="container mx-auto px-4">
        <div className="max-w-6xl mx-auto space-y-12">
          {/* Section Header */}
          <div className="text-center space-y-4">
            <h2 className="text-4xl font-bold">Everything You Need to Win</h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
              Powerful AI tools designed to give you the edge in your fantasy league
            </p>
          </div>

          {/* Features Grid */}
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {features.map((feature, index) => {
              const Icon = feature.icon;
              return (
                <Card
                  key={index}
                  className="border-border/50 bg-card/50 backdrop-blur-sm hover:border-primary/50 transition-all duration-300 hover:shadow-[0_0_30px_hsl(var(--primary)/0.15)] group"
                >
                  <CardHeader>
                    <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center mb-4 group-hover:bg-primary/20 transition-colors">
                      <Icon className="h-6 w-6 text-primary" />
                    </div>
                    <CardTitle className="text-lg">{feature.title}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <CardDescription className="text-sm leading-relaxed">
                      {feature.description}
                    </CardDescription>
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="w-full"
                      onClick={() => navigate(feature.redirect)}
                    >
                      Try It
                    </Button>
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
