import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { Header } from "@/components/Header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Crown, User, Calendar, Coins } from "lucide-react";
import { useTokens } from "@/hooks/useTokens";

export default function Profile() {
  const navigate = useNavigate();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const { balance, hasUnlimited } = useTokens();
  const [subscriptionExpiry, setSubscriptionExpiry] = useState<string | null>(null);

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      navigate("/auth");
      return;
    }

    setUser(user);

    // Fetch subscription details
    const { data: tokenData } = await supabase
      .from("user_tokens")
      .select("subscription_expires_at")
      .eq("user_id", user.id)
      .single();

    if (tokenData?.subscription_expires_at) {
      setSubscriptionExpiry(tokenData.subscription_expires_at);
    }

    setLoading(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Header user={user} />
      
      <main className="container mx-auto px-4 pt-24 pb-12">
        <div className="max-w-4xl mx-auto space-y-6">
          <div>
            <h1 className="text-3xl font-bold">Your Profile</h1>
            <p className="text-muted-foreground">View your account details and subscription status</p>
          </div>

          {/* Account Type Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User className="h-5 w-5" />
                Account Type
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Status</span>
                {hasUnlimited ? (
                  <Badge variant="default" className="flex items-center gap-2">
                    <Crown className="h-4 w-4" />
                    Subscriber
                  </Badge>
                ) : (
                  <Badge variant="secondary">Basic</Badge>
                )}
              </div>

              {hasUnlimited && subscriptionExpiry && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Subscription Expires</span>
                  <span className="font-medium flex items-center gap-2">
                    <Calendar className="h-4 w-4" />
                    {new Date(subscriptionExpiry).toLocaleDateString()}
                  </span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Subscription Benefits Card */}
          <Card>
            <CardHeader>
              <CardTitle>Your Benefits</CardTitle>
              <CardDescription>
                {hasUnlimited 
                  ? "As a subscriber, you have access to all premium features"
                  : "Upgrade to subscriber for unlimited access"
                }
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {hasUnlimited ? (
                <div className="space-y-3">
                  <div className="flex items-start gap-3">
                    <div className="mt-1">
                      <div className="h-2 w-2 rounded-full bg-primary" />
                    </div>
                    <div>
                      <p className="font-medium">Unlimited Tool Access</p>
                      <p className="text-sm text-muted-foreground">
                        Use all AI tools without token deductions
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="mt-1">
                      <div className="h-2 w-2 rounded-full bg-primary" />
                    </div>
                    <div>
                      <p className="font-medium">Monthly Token Bonus</p>
                      <p className="text-sm text-muted-foreground">
                        Receive 10 bonus tokens each month
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="mt-1">
                      <div className="h-2 w-2 rounded-full bg-primary" />
                    </div>
                    <div>
                      <p className="font-medium">Priority Support</p>
                      <p className="text-sm text-muted-foreground">
                        Get priority assistance from our team
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-start gap-3">
                    <div className="mt-1">
                      <div className="h-2 w-2 rounded-full bg-muted" />
                    </div>
                    <div>
                      <p className="font-medium text-muted-foreground">Token-Based Access</p>
                      <p className="text-sm text-muted-foreground">
                        Each tool use costs tokens
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="mt-1">
                      <div className="h-2 w-2 rounded-full bg-muted" />
                    </div>
                    <div>
                      <p className="font-medium text-muted-foreground">Limited Features</p>
                      <p className="text-sm text-muted-foreground">
                        Access to basic features only
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Token Balance Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Coins className="h-5 w-5" />
                Token Balance
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Current Balance</span>
                <span className="text-2xl font-bold">{balance ?? 0} tokens</span>
              </div>
              {!hasUnlimited && (
                <p className="text-sm text-muted-foreground mt-4">
                  Need more tokens? Visit the{" "}
                  <a href="/shop" className="text-primary hover:underline">
                    Token Shop
                  </a>
                </p>
              )}
            </CardContent>
          </Card>

          {/* Account Info Card */}
          <Card>
            <CardHeader>
              <CardTitle>Account Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Email</span>
                <span className="font-medium">{user?.email}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">User ID</span>
                <span className="font-mono text-xs">{user?.id.slice(0, 8)}...</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
