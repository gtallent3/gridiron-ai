import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useNavigate } from "react-router-dom";

const comparisonData = [
  { feature: "Start/Sit Analyzer", free: "Basic projection", synced: "Custom scoring" },
  { feature: "Trade Analyzer", free: "2-player limit", synced: "Real roster impact" },
  { feature: "AI Assistant", free: "Generic advice", synced: "Personalized insights" },
  { feature: "Token Rewards", free: false, synced: true },
  { feature: "Props Betting", free: false, synced: true },
  { feature: "Waiver Wire AI", free: false, synced: true },
  { feature: "Weekly Projections", free: "League average", synced: "Your league settings" },
];

export const FeatureComparison = () => {
  const navigate = useNavigate();

  return (
    <section id="comparison" className="py-20 scroll-mt-20">
      <div className="container mx-auto px-4">
        <div className="max-w-5xl mx-auto space-y-12">
          {/* Header */}
          <div className="text-center space-y-4">
            <h2 className="text-4xl font-bold">Free Demo vs League Sync</h2>
            <p className="text-muted-foreground text-lg">
              See what you unlock when you connect your fantasy league
            </p>
          </div>

          {/* Comparison Table */}
          <Card className="overflow-hidden">
            <CardHeader className="bg-muted/30">
              <div className="grid grid-cols-3 gap-4">
                <div className="col-span-1">
                  <CardTitle className="text-lg">Feature</CardTitle>
                </div>
                <div className="text-center">
                  <CardTitle className="text-lg">Free Demo</CardTitle>
                </div>
                <div className="text-center">
                  <CardTitle className="text-lg bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                    League Sync
                  </CardTitle>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {comparisonData.map((row, index) => (
                <div
                  key={index}
                  className={`grid grid-cols-3 gap-4 p-4 ${
                    index % 2 === 0 ? "bg-muted/10" : ""
                  }`}
                >
                  <div className="font-medium text-sm sm:text-base">{row.feature}</div>
                  <div className="text-center text-sm flex items-center justify-center">
                    {typeof row.free === "boolean" ? (
                      row.free ? (
                        <Check className="h-5 w-5 text-primary" />
                      ) : (
                        <X className="h-5 w-5 text-muted-foreground" />
                      )
                    ) : (
                      <span className="text-muted-foreground">{row.free}</span>
                    )}
                  </div>
                  <div className="text-center text-sm flex items-center justify-center">
                    {typeof row.synced === "boolean" ? (
                      row.synced ? (
                        <Check className="h-5 w-5 text-primary" />
                      ) : (
                        <X className="h-5 w-5 text-muted-foreground" />
                      )
                    ) : (
                      <span className="font-medium text-foreground">{row.synced}</span>
                    )}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Button size="lg" onClick={() => navigate('/auth')}>
              Sign Up for Free
            </Button>
            <Button 
              variant="outline" 
              size="lg"
              onClick={() => navigate('/auth')}
            >
              Already Have an Account?
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
};
