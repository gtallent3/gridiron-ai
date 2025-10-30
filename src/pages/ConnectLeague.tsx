import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";
import { z } from "zod";
import { EspnCookieExtractor } from "@/components/EspnCookieExtractor";

const sleeperSchema = z.object({
  username: z.string().trim().min(3, "Username must be at least 3 characters").max(25, "Username is too long").regex(/^[a-zA-Z0-9_-]+$/, "Username can only contain letters, numbers, hyphens, and underscores"),
});

export default function ConnectLeague() {
  const [sleeperUsername, setSleeperUsername] = useState("");
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
    // Validate input with zod schema
    const validationResult = sleeperSchema.safeParse({ username: sleeperUsername });
    
    if (!validationResult.success) {
      const firstError = validationResult.error.errors[0];
      toast({
        title: "Validation Error",
        description: firstError.message,
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('sync-sleeper-league', {
        body: { username: validationResult.data.username },
      });

      if (error) throw error;

      toast({
        title: "Success!",
        description: data.message || "League synced successfully",
      });

      setTimeout(() => navigate('/'), 1500);
    } catch (error: any) {
      toast({
        title: "Connection failed",
        description: "Unable to connect your Sleeper account. Please verify your username and try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleEspnCookieSuccess = async (credentials: { swid: string; espn_s2: string; leagueId: string }) => {
    setIsLoading(true);
    try {
      // Refresh session to ensure valid token
      const { data: { session }, error: refreshError } = await supabase.auth.refreshSession();
      
      if (refreshError || !session) {
        throw new Error('Your session has expired. Please log out and log back in.');
      }

      const { data, error } = await supabase.functions.invoke('sync-espn-league', {
        body: credentials,
      });

      if (error) throw error;

      toast({
        title: "✅ League Connected!",
        description: data.message || "Your ESPN league has been synced. Analyzing your roster now!",
      });

      setTimeout(() => navigate('/'), 2000);
    } catch (error: any) {
      const errorMsg = error.message?.includes('authenticate') 
        ? "Unable to authenticate. Please check your credentials are correct."
        : error.message?.includes('team')
        ? "Unable to find your team in this league. Please verify the League ID."
        : "Unable to connect your ESPN league. Please try again.";
      
      toast({
        title: "Connection Failed",
        description: errorMsg,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-secondary/20">
      <div className="container mx-auto px-4 py-20">
        <div className="max-w-4xl mx-auto space-y-8">
          <div className="text-center space-y-4">
            <h1 className="text-4xl font-bold">Connect Your League</h1>
            <p className="text-muted-foreground text-lg">
              Sync your fantasy football league to get AI-powered insights
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-6 max-w-2xl mx-auto">
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
                <CardDescription>Secure one-time setup</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="text-center py-4">
                  <EspnCookieExtractor onSuccess={handleEspnCookieSuccess} />
                  <p className="text-sm text-muted-foreground mt-3">
                    Guided setup with platform-specific instructions
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
