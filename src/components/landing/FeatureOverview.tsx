import { Brain, TrendingUp, Zap, Trophy, ArrowRight } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AIChatDemo } from "./demos/AIChatDemo";
import { StartSitDemo } from "./demos/StartSitDemo";
import { TradeDemo } from "./demos/TradeDemo";
import { PropsDemo } from "./demos/PropsDemo";

const features = [
  {
    icon: Brain,
    title: "AI Assistant",
    description: "Ask start/sit or trade questions and get instant AI-powered answers.",
    demo: AIChatDemo,
    cta: "Try It",
    link: "/auth",
  },
  {
    icon: Zap,
    title: "Start/Sit Analyzer",
    description: "Compare players using real projections and scoring settings.",
    demo: StartSitDemo,
    cta: "Try It",
    link: "/auth",
  },
  {
    icon: TrendingUp,
    title: "Trade Analyzer",
    description: "Find out who wins every deal with AI-powered trade evaluation.",
    demo: TradeDemo,
    cta: "Try It",
    link: "/auth",
  },
  {
    icon: Trophy,
    title: "Props & Tokens",
    description: "Play weekly props, earn tokens, and compete on the leaderboard.",
    demo: PropsDemo,
    cta: "Learn More",
    link: "/props",
  },
];

export const FeatureOverview = () => {

  return (
    <section id="features" className="py-12 relative scroll-mt-20">
      <div className="container mx-auto px-4">
        <div className="max-w-6xl mx-auto space-y-12">
          {/* Section Header */}
          <div className="text-center space-y-4">
            <h2 className="text-4xl font-bold">Everything You Need to Win</h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
              Powerful AI tools designed to give you the edge in your fantasy league
            </p>
            <p className="text-muted-foreground text-lg">
              (Scroll for demos)
            </p>
          </div>

          {/* Features Grid */}
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {features.map((feature, index) => {
              const Icon = feature.icon;
              const DemoComponent = feature.demo;
              return (
                <Card
                  key={index}
                  className="border-border/50 bg-card/50 backdrop-blur-sm hover:border-primary/50 transition-all duration-300 hover:shadow-[0_0_30px_hsl(var(--primary)/0.15)] group overflow-hidden"
                >
                  <CardHeader className="space-y-4">
                    <div className="flex items-start justify-between">
                      <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                        <Icon className="h-6 w-6 text-primary" />
                      </div>
                    </div>
                    <CardTitle className="text-lg">{feature.title}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <CardDescription className="text-sm leading-relaxed">
                      {feature.description}
                    </CardDescription>
                    
                    {/* Demo Preview */}
                    <div className="relative">
                      <DemoComponent />
                    </div>

                    {/* CTA Section */}
                    <div className="space-y-2 pt-2">
                      <Button 
                        asChild 
                        className="w-full group/btn"
                        size="sm"
                      >
                        <a href={feature.link}>
                          {feature.cta}
                          <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover/btn:translate-x-1" />
                        </a>
                      </Button>
                      <p className="text-[10px] text-center text-muted-foreground">
                        Full access with free signup — 3 tokens to start
                      </p>
                    </div>
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
