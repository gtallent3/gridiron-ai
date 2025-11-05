import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Coins, Sparkles, Crown, Check } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useNavigate, useSearchParams } from "react-router-dom";

interface TokenPackage {
  id: string;
  name: string;
  tokens: number;
  price_cents: number;
  bonus_percentage: number;
  stripe_price_id: string | null;
}

export default function Shop() {
  const [packages, setPackages] = useState<TokenPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [purchasing, setPurchasing] = useState<string | null>(null);
  const { toast } = useToast();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    fetchPackages();
    
    // Check for success or cancel in URL
    if (searchParams.get("success") === "true") {
      toast({
        title: "Purchase Successful!",
        description: "Your tokens have been added to your account.",
      });
      // Clear the success param
      setSearchParams({});
      // Refresh the page to update token balance
      window.location.reload();
    } else if (searchParams.get("canceled") === "true") {
      toast({
        title: "Payment Cancelled",
        description: "You can try again anytime.",
        variant: "destructive",
      });
      // Clear the canceled param
      setSearchParams({});
    }
  }, [searchParams, setSearchParams, toast]);

  const fetchPackages = async () => {
    try {
      const { data, error } = await supabase
        .from("token_packages")
        .select("*")
        .eq("is_active", true)
        .order("display_order");

      if (error) throw error;
      setPackages(data || []);
    } catch (error: any) {
      toast({
        title: "Error",
        description: "Failed to load token packages",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handlePurchase = async (packageId: string) => {
    setPurchasing(packageId);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        navigate("/auth");
        return;
      }

      let priceId: string;
      let packageType: string;
      let tokens: number = 0;
      let packageName: string = "";

      if (packageId === "unlimited") {
        priceId = "price_1SLTG1IEGdCnVLfuWjWUmZ1U";
        packageType = "subscription";
        tokens = 10;
        packageName = "Unlimited Monthly";
      } else {
        const pkg = packages.find(p => p.id === packageId);
        if (!pkg || !pkg.stripe_price_id) {
          throw new Error("Package not found or missing Stripe price ID");
        }
        priceId = pkg.stripe_price_id;
        packageType = "one-time";
        // Calculate total tokens including bonus
        tokens = pkg.tokens + Math.floor(pkg.tokens * pkg.bonus_percentage / 100);
        packageName = pkg.name;
      }

      const { data, error } = await supabase.functions.invoke("create-checkout", {
        body: {
          price_id: priceId,
          package_type: packageType,
          package_id: packageId,
          tokens,
          package_name: packageName,
        },
      });

      if (error) throw error;

      if (data?.url) {
        window.open(data.url, "_blank");
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setPurchasing(null);
    }
  };

  if (loading) {
    return (
      <div className="container mx-auto py-8">
        <div className="text-center">Loading...</div>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-4 sm:py-6 lg:py-8 px-4 sm:px-6 mt-16">
      <div className="max-w-6xl mx-auto spacing-mobile">
        {/* Header */}
        <div className="text-center spacing-mobile">
          <div className="inline-flex items-center gap-2 px-3 sm:px-4 py-2 rounded-full bg-amber-500/10 border border-amber-500/20">
            <Sparkles className="h-4 w-4 text-amber-400" />
            <span className="text-xs sm:text-sm font-medium text-amber-400">Token Shop</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold">Power Up Your Game</h1>
          <p className="text-muted-foreground text-base sm:text-lg max-w-2xl mx-auto px-4">
            Get tokens to unlock premium AI features and weekly PredictIQ
          </p>
        </div>

        {/* Free Weekly Token Banner */}
        <Card className="bg-gradient-to-r from-emerald-500/10 to-green-500/10 border-emerald-500/20">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <h3 className="font-semibold text-lg flex items-center gap-2">
                  <Coins className="h-5 w-5 text-emerald-400" />
                  Earn 1 Free Token Every Week!
                </h3>
                <p className="text-sm text-muted-foreground">
                  Keep engaged and collect your weekly bonus token
                </p>
              </div>
              <Badge variant="outline" className="bg-emerald-500/20 text-emerald-400 border-emerald-500/50">
                Active
              </Badge>
            </div>
          </CardContent>
        </Card>

        {/* Unlimited Plan */}
        <Card className="relative overflow-hidden border-2 border-purple-500/50 bg-gradient-to-br from-purple-500/10 via-transparent to-pink-500/10">
          <div className="absolute top-0 right-0 w-32 h-32 bg-purple-500/20 rounded-full blur-3xl" />
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-2xl flex items-center gap-2">
                <Crown className="h-6 w-6 text-purple-400" />
                Unlimited Monthly
              </CardTitle>
              <Badge className="bg-purple-500 text-white">Most Popular</Badge>
            </div>
            <CardDescription className="text-base">
              All AI features + 10 free tokens
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="text-4xl font-bold">
              $14.99<span className="text-lg text-muted-foreground font-normal">/month</span>
            </div>
            <ul className="space-y-2">
              {[
                "Unlimited AI Assistant questions",
                "Unlimited Start/Sit recommendations",
                "Unlimited Trade Analysis",
                "10 free tokens monthly",
                "Priority support",
                "Early access to new features"
              ].map((feature) => (
                <li key={feature} className="flex items-center gap-2 text-sm">
                  <Check className="h-4 w-4 text-purple-400" />
                  <span>{feature}</span>
                </li>
              ))}
            </ul>
          </CardContent>
          <CardFooter>
            <Button
              onClick={() => handlePurchase("unlimited")}
              disabled={purchasing === "unlimited"}
              className="w-full bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white font-semibold text-lg py-6"
            >
              {purchasing === "unlimited" ? "Processing..." : "Start 7-Day Free Trial"}
            </Button>
          </CardFooter>
        </Card>

        {/* Token Packages */}
        <div>
          <h2 className="text-xl sm:text-2xl font-bold mb-4 sm:mb-6 text-center">Or Buy Token Packages</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
            {packages.map((pkg) => (
              <Card key={pkg.id} className="relative overflow-hidden border-amber-500/30 hover:border-amber-500/50 transition-colors">
                {pkg.bonus_percentage > 0 && (
                  <Badge className="absolute top-4 right-4 bg-amber-500 text-black">
                    +{pkg.bonus_percentage}% Bonus
                  </Badge>
                )}
                <CardHeader>
                  <CardTitle className="text-xl">{pkg.name}</CardTitle>
                  <CardDescription>
                    {pkg.bonus_percentage > 0
                      ? `${pkg.tokens + Math.floor(pkg.tokens * pkg.bonus_percentage / 100)} tokens (${pkg.tokens} + ${Math.floor(pkg.tokens * pkg.bonus_percentage / 100)} bonus)`
                      : `${pkg.tokens} tokens`}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold">
                    ${(pkg.price_cents / 100).toFixed(2)}
                  </div>
                  <p className="text-sm text-muted-foreground mt-2">
                    ${((pkg.price_cents / 100) / (pkg.tokens + Math.floor(pkg.tokens * pkg.bonus_percentage / 100))).toFixed(2)} per token
                  </p>
                </CardContent>
                <CardFooter>
                  <Button
                    onClick={() => handlePurchase(pkg.id)}
                    disabled={purchasing === pkg.id}
                    className="w-full bg-gradient-to-r from-amber-500 to-yellow-500 hover:from-amber-600 hover:to-yellow-600 text-black font-semibold"
                  >
                    {purchasing === pkg.id ? (
                      "Processing..."
                    ) : (
                      <>
                        <Coins className="h-4 w-4 mr-2" />
                        Buy Now
                      </>
                    )}
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>
        </div>

        {/* Info Section */}
        <Card className="bg-muted/50">
          <CardContent className="pt-6 space-y-4">
            <h3 className="font-semibold text-lg">Why Gridiron-GM Tokens?</h3>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>✓ <strong>No Vig, No Juice:</strong> 100% fair lines on all predictions</li>
              <li>✓ <strong>Never Expires:</strong> Your tokens stay in your account</li>
              <li>✓ <strong>Multiple Uses:</strong> AI features and predictions</li>
              <li>✓ <strong>Secure:</strong> Tokens cannot be transferred or sold</li>
              <li>✓ <strong>Weekly Rewards:</strong> Active users get free tokens</li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
