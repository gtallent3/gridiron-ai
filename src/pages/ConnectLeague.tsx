import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";

export default function ConnectLeague() {
  const [sleeperUsername, setSleeperUsername] = useState("");
  const [espnCredentials, setEspnCredentials] = useState({ espn_s2: "", swid: "", leagueId: "" });
  const [isLoading, setIsLoading] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const { toast } = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    // Check if user is logged in
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        navigate('/auth');
      } else {
        setCheckingAuth(false);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        navigate('/auth');
      }
    });

    return () => subscription.unsubscribe();
  }, [navigate]);

  if (checkingAuth) {
    return null;
  }

  const handleSleeperConnect = async () => {
    if (!sleeperUsername.trim()) {
      toast({
        title: "Username required",
        description: "Please enter your Sleeper username",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('sync-sleeper-league', {
        body: { username: sleeperUsername },
      });

      if (error) throw error;

      toast({
        title: "Success!",
        description: data.message || "League synced successfully",
      });

      // Navigate to dashboard after a short delay
      setTimeout(() => navigate('/'), 1500);
    } catch (error: any) {
      console.error('Error connecting Sleeper:', error);
      toast({
        title: "Connection failed",
        description: error.message || "Failed to connect to Sleeper",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleEspnConnect = async () => {
    if (!espnCredentials.espn_s2.trim() || !espnCredentials.swid.trim() || !espnCredentials.leagueId.trim()) {
      toast({
        title: "Credentials required",
        description: "Please enter your ESPN espn_s2, SWID cookies, and League ID",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    try {
      // Explicitly refresh the session to ensure we have a valid token
      const { data: { session }, error: refreshError } = await supabase.auth.refreshSession();
      
      if (refreshError || !session) {
        throw new Error('Your session has expired. Please log out and log back in.');
      }

      console.log('Session valid, invoking ESPN sync function...');

      const { data, error } = await supabase.functions.invoke('sync-espn-league', {
        body: espnCredentials,
      });

      if (error) throw error;

      toast({
        title: "Success!",
        description: data.message || "ESPN league synced successfully",
      });

      setTimeout(() => navigate('/'), 1500);
    } catch (error: any) {
      console.error('Error connecting ESPN:', error);
      
      // Try to extract the actual error message from the backend response
      let errorMessage = "Failed to connect to ESPN";
      
      if (error.message && error.message.includes("non-2xx")) {
        // Edge function returned an error - try to get the error from data
        errorMessage = "Could not connect to ESPN. Please verify your cookies and league membership.";
      } else if (error.message) {
        errorMessage = error.message;
      }
      
      // If the error context contains an error field, use that
      if (error.context?.error) {
        errorMessage = error.context.error;
      }
      
      toast({
        title: "Connection failed",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleComingSoon = (platform: string) => {
    toast({
      title: "Coming Soon",
      description: `${platform} integration will be available soon. Requires OAuth setup.`,
    });
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-secondary/20">
      <div className="container mx-auto px-4 py-20">
        <div className="max-w-4xl mx-auto space-y-8">
          <div className="text-center space-y-4">
            <h1 className="text-4xl font-bold">Connect Your League</h1>
            <p className="text-muted-foreground text-lg">
              Sync your fantasy football leagues to get AI-powered insights
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            {/* Sleeper Card */}
            <Card className="border-2 border-primary/50">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <div className="h-10 w-10 rounded-full bg-primary/20 flex items-center justify-center">
                    <span className="text-xl font-bold">S</span>
                  </div>
                  Sleeper
                </CardTitle>
                <CardDescription>Connect via username</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="sleeper-username">Sleeper Username</Label>
                  <Input
                    id="sleeper-username"
                    placeholder="Enter your username"
                    value={sleeperUsername}
                    onChange={(e) => setSleeperUsername(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && handleSleeperConnect()}
                  />
                </div>
                <Button 
                  onClick={handleSleeperConnect} 
                  disabled={isLoading}
                  className="w-full"
                  variant="glow"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Syncing...
                    </>
                  ) : (
                    'Connect Sleeper'
                  )}
                </Button>
              </CardContent>
            </Card>

            {/* ESPN Card */}
            <Card className="border-2 border-primary/50">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <div className="h-10 w-10 rounded-full bg-red-500/20 flex items-center justify-center">
                    <span className="text-xl font-bold">E</span>
                  </div>
                  ESPN
                </CardTitle>
                <CardDescription>Connect via cookies</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="espn-s2">espn_s2 Cookie</Label>
                  <Input
                    id="espn-s2"
                    placeholder="Enter espn_s2 cookie"
                    value={espnCredentials.espn_s2}
                    onChange={(e) => setEspnCredentials({...espnCredentials, espn_s2: e.target.value})}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="swid">SWID Cookie</Label>
                  <Input
                    id="swid"
                    placeholder="Enter SWID cookie"
                    value={espnCredentials.swid}
                    onChange={(e) => setEspnCredentials({...espnCredentials, swid: e.target.value})}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="league-id">League ID</Label>
                  <Input
                    id="league-id"
                    placeholder="Enter League ID"
                    value={espnCredentials.leagueId}
                    onChange={(e) => setEspnCredentials({...espnCredentials, leagueId: e.target.value})}
                  />
                </div>
                <details className="text-xs text-muted-foreground">
                  <summary className="cursor-pointer hover:text-foreground">How to find cookies?</summary>
                  <ol className="mt-2 space-y-1 list-decimal list-inside">
                    <li>Log into ESPN Fantasy Football</li>
                    <li>Open browser DevTools (F12)</li>
                    <li>Go to Application/Storage → Cookies</li>
                    <li>Find espn_s2 and SWID values</li>
                    <li>League ID is in your league URL</li>
                  </ol>
                </details>
                <Button 
                  onClick={handleEspnConnect} 
                  disabled={isLoading}
                  className="w-full"
                  variant="glow"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Syncing...
                    </>
                  ) : (
                    'Connect ESPN'
                  )}
                </Button>
              </CardContent>
            </Card>

            {/* Yahoo Card */}
            <Card className="opacity-60">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <div className="h-10 w-10 rounded-full bg-purple-500/20 flex items-center justify-center">
                    <span className="text-xl font-bold">Y</span>
                  </div>
                  Yahoo
                </CardTitle>
                <CardDescription>OAuth integration</CardDescription>
              </CardHeader>
              <CardContent>
                <Button 
                  onClick={() => handleComingSoon('Yahoo')} 
                  className="w-full"
                  variant="outline"
                  disabled
                >
                  Coming Soon
                </Button>
              </CardContent>
            </Card>
          </div>

          <Card className="bg-accent/5 border-accent/20">
            <CardHeader>
              <CardTitle className="text-xl">How it works</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <div className="flex gap-3">
                <div className="h-6 w-6 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <span className="text-xs font-bold">1</span>
                </div>
                <p>Connect your league by entering your username or logging in via OAuth</p>
              </div>
              <div className="flex gap-3">
                <div className="h-6 w-6 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <span className="text-xs font-bold">2</span>
                </div>
                <p>We securely sync your roster, league settings, and scoring format</p>
              </div>
              <div className="flex gap-3">
                <div className="h-6 w-6 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <span className="text-xs font-bold">3</span>
                </div>
                <p>Get AI-powered start/sit and trade recommendations based on your actual team</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}