import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { Header } from "@/components/Header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Crown, User, Calendar, Coins } from "lucide-react";
import { useTokens } from "@/hooks/useTokens";
import { useToast } from "@/hooks/use-toast";

export default function Profile() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const { balance, hasUnlimited } = useTokens();
  const [subscriptionExpiry, setSubscriptionExpiry] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [newUsername, setNewUsername] = useState("");
  const [isEditingUsername, setIsEditingUsername] = useState(false);
  const [savingUsername, setSavingUsername] = useState(false);

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

    // Fetch profile
    const { data: profile } = await supabase
      .from("profiles")
      .select("username")
      .eq("id", user.id)
      .single();

    if (profile) {
      setUsername(profile.username);
      setNewUsername(profile.username);
    }

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

  const handleUpdateUsername = async () => {
    if (newUsername === username) {
      setIsEditingUsername(false);
      return;
    }

    setSavingUsername(true);
    try {
      // Check if username is taken
      const { data: existing } = await supabase
        .from("profiles")
        .select("username")
        .eq("username", newUsername)
        .neq("id", user.id)
        .maybeSingle();

      if (existing) {
        toast({
          title: "Username Taken",
          description: "This username is already in use.",
          variant: "destructive",
        });
        setSavingUsername(false);
        return;
      }

      const { error } = await supabase
        .from("profiles")
        .update({ username: newUsername })
        .eq("id", user.id);

      if (error) throw error;

      setUsername(newUsername);
      setIsEditingUsername(false);
      toast({
        title: "Username Updated",
        description: "Your username has been changed successfully.",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to update username",
        variant: "destructive",
      });
    } finally {
      setSavingUsername(false);
    }
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
                  ? "As a subscriber, you have unlimited access to AI tools"
                  : "Upgrade to subscriber for unlimited tool access"
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
                      <p className="font-medium">Unlimited AI Tools</p>
                      <p className="text-sm text-muted-foreground">
                        Trade Analyzer, Start/Sit, AI Chat - all free
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
                        Receive 10 bonus tokens each month for prop betting
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="mt-1">
                      <div className="h-2 w-2 rounded-full bg-amber-500" />
                    </div>
                    <div>
                      <p className="font-medium">Prop Betting</p>
                      <p className="text-sm text-muted-foreground">
                        Use tokens to place prop bets (subscribers still need tokens for betting)
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
                        Each tool and prop bet costs tokens
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="mt-1">
                      <div className="h-2 w-2 rounded-full bg-muted" />
                    </div>
                    <div>
                      <p className="font-medium text-muted-foreground">Basic Features</p>
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
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Username</span>
                {isEditingUsername ? (
                  <div className="flex items-center gap-2">
                    <Input
                      value={newUsername}
                      onChange={(e) => setNewUsername(e.target.value)}
                      className="w-40"
                      minLength={3}
                      maxLength={20}
                      pattern="[a-zA-Z0-9_]+"
                    />
                    <Button 
                      size="sm" 
                      onClick={handleUpdateUsername}
                      disabled={savingUsername}
                    >
                      {savingUsername ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
                    </Button>
                    <Button 
                      size="sm" 
                      variant="outline"
                      onClick={() => {
                        setIsEditingUsername(false);
                        setNewUsername(username);
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{username}</span>
                    <Button 
                      size="sm" 
                      variant="outline"
                      onClick={() => setIsEditingUsername(true)}
                    >
                      Edit
                    </Button>
                  </div>
                )}
              </div>
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
