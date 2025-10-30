import { Brain, TrendingUp, Zap, Trophy, ArrowRight } from "lucide-react";
import { useState, useEffect, useRef } from "react";
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
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [isTouchDevice, setIsTouchDevice] = useState(false);
  const [visibleCards, setVisibleCards] = useState<Set<number>>(new Set());
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    // Detect if it's a touch device
    const checkTouch = () => {
      setIsTouchDevice('ontouchstart' in window || navigator.maxTouchPoints > 0);
    };
    checkTouch();
  }, []);

  useEffect(() => {
    if (!isTouchDevice) return;

    // Set up intersection observer for mobile
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const index = cardRefs.current.findIndex((ref) => ref === entry.target);
          if (entry.isIntersecting && index !== -1) {
            setVisibleCards((prev) => new Set(prev).add(index));
            // Reset after animation completes
            setTimeout(() => {
              setVisibleCards((prev) => {
                const newSet = new Set(prev);
                newSet.delete(index);
                return newSet;
              });
            }, 3000); // Reset after 3 seconds
          }
        });
      },
      { threshold: 0.5 }
    );

    cardRefs.current.forEach((ref) => {
      if (ref) observer.observe(ref);
    });

    return () => observer.disconnect();
  }, [isTouchDevice]);

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
            {!isTouchDevice && (
              <p className="text-muted-foreground text-sm">
                Hover over each card to see it in action
              </p>
            )}
          </div>

          {/* Features Grid */}
          <div className="grid sm:grid-cols-1 md:grid-cols-2 gap-6 max-w-5xl mx-auto">
            {features.map((feature, index) => {
              const Icon = feature.icon;
              const DemoComponent = feature.demo;
              return (
                <Card
                  key={index}
                  ref={(el) => (cardRefs.current[index] = el)}
                  className="border-border/50 bg-card/50 backdrop-blur-sm hover:border-primary/50 transition-all duration-300 hover:shadow-[0_0_30px_hsl(var(--primary)/0.15)] group overflow-hidden"
                  onMouseEnter={() => !isTouchDevice && setHoveredIndex(index)}
                  onMouseLeave={() => !isTouchDevice && setHoveredIndex(null)}
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
                      <DemoComponent 
                        isHovered={
                          isTouchDevice 
                            ? visibleCards.has(index)
                            : hoveredIndex === index
                        } 
                      />
                      
                      {/* Hover hint for desktop only */}
                      {!isTouchDevice && hoveredIndex !== index && (
                        <div className="absolute inset-0 flex items-center justify-center bg-background/60 backdrop-blur-[2px] rounded-lg pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                          <div className="text-xs text-muted-foreground font-medium px-3 py-1.5 bg-card border border-border rounded-full">
                            Hover to preview
                          </div>
                        </div>
                      )}
                    </div>

                    {/* CTA Section */}
                    <div className="space-y-2 pt-2">
                      {feature.cta !== "Try It" && (
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
                      )}
                      <p className="text-[10px] text-center text-muted-foreground">
                        Sign up now to receive 3 free tokens
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
