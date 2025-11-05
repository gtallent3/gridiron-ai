import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Star, TrendingUp } from "lucide-react";
import { useNavigate } from "react-router-dom";

const testimonials = [
  {
    name: "Mike R.",
    league: "12-Team PPR",
    quote: "This AI helped me win my first championship in 5 years. The start/sit recommendations were spot on every week.",
    rating: 5,
  },
  {
    name: "Sarah T.",
    league: "Dynasty League",
    quote: "The trade analyzer saved me from making terrible deals. Best fantasy tool I've ever used.",
    rating: 5,
  },
  {
    name: "James L.",
    league: "10-Team Standard",
    quote: "PredictIQ is addictive! Love earning tokens and competing on the leaderboard.",
    rating: 5,
  },
];

export const Testimonials = () => {
  const navigate = useNavigate();

  return (
    <section id="testimonials" className="py-20 bg-muted/30">
      <div className="container mx-auto px-4">
        <div className="max-w-6xl mx-auto space-y-12">
          {/* Header */}
          <div className="text-center space-y-4">
            <h2 className="text-4xl font-bold">Trusted by Fantasy Players Everywhere</h2>
            <p className="text-muted-foreground text-lg">
              Join thousands of winners using AI to dominate their leagues
            </p>
          </div>

          {/* Testimonials Grid */}
          <div className="grid md:grid-cols-3 gap-6">
            {testimonials.map((testimonial, index) => (
              <Card key={index} className="border-border/50 bg-card/50 backdrop-blur-sm">
                <CardContent className="pt-6 space-y-4">
                  {/* Rating */}
                  <div className="flex gap-1">
                    {Array.from({ length: testimonial.rating }).map((_, i) => (
                      <Star key={i} className="h-4 w-4 fill-primary text-primary" />
                    ))}
                  </div>

                  {/* Quote */}
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    "{testimonial.quote}"
                  </p>

                  {/* Author */}
                  <div>
                    <p className="font-semibold text-sm">{testimonial.name}</p>
                    <p className="text-xs text-muted-foreground">{testimonial.league}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Stats */}
          <Card className="border-primary/20 bg-gradient-to-r from-primary/5 to-accent/5">
            <CardContent className="py-8">
              <div className="flex flex-col sm:flex-row items-center justify-center gap-8 sm:gap-12">
                <div className="text-center">
                  <div className="flex items-center justify-center gap-2 mb-2">
                    <TrendingUp className="h-6 w-6 text-primary" />
                    <p className="text-3xl font-bold text-foreground">3,000+</p>
                  </div>
                  <p className="text-sm text-muted-foreground">Leagues Synced This Season</p>
                </div>
                <div className="text-center">
                  <div className="flex items-center justify-center gap-2 mb-2">
                    <Star className="h-6 w-6 text-primary" />
                    <p className="text-3xl font-bold text-foreground">4.9/5</p>
                  </div>
                  <p className="text-sm text-muted-foreground">Average User Rating</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* CTA */}
          <div className="text-center">
            <Button size="lg" onClick={() => navigate('/auth')}>
              Join Free for 7 Days
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
};
