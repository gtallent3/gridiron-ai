import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, HelpCircle, ExternalLink, CheckCircle, Copy } from "lucide-react";
import { z } from "zod";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";

const sleeperSchema = z.object({
  username: z.string().trim().min(3, "Username must be at least 3 characters").max(25, "Username is too long").regex(/^[a-zA-Z0-9_-]+$/, "Username can only contain letters, numbers, hyphens, and underscores"),
});

const espnSchema = z.object({
  leagueId: z.string().trim().min(1, "League ID is required").max(50, "League ID is too long").regex(/^\d+$/, "League ID must be numeric"),
  espn_s2: z.string().trim().min(10, "ESPN S2 cookie is required").max(1000, "ESPN S2 cookie is too long"),
  swid: z.string().trim().min(5, "SWID cookie is required").max(100, "SWID cookie is too long"),
});

// Component for ESPN Cookie Instructions
function EspnCookieHelper() {
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-2">
          <HelpCircle className="h-4 w-4" />
          How to get ESPN cookies
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>ESPN Cookie Setup Guide</DialogTitle>
          <DialogDescription>
            Follow these steps to connect your ESPN league securely
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-6">
          <Alert>
            <AlertDescription>
              🔒 Your credentials are encrypted and stored securely. We only use them to fetch your league data.
            </AlertDescription>
          </Alert>

          <div className="space-y-4">
            <div className="border rounded-lg p-4 bg-accent/5">
              <div className="flex items-start gap-3">
                <div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                  <span className="text-sm font-bold">1</span>
                </div>
                <div className="space-y-2 flex-1">
                  <h3 className="font-semibold">Open ESPN Fantasy Football</h3>
                  <p className="text-sm text-muted-foreground">
                    Log into your ESPN account and navigate to any of your fantasy leagues
                  </p>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="gap-2"
                    onClick={() => window.open('https://fantasy.espn.com/football/', '_blank')}
                  >
                    <ExternalLink className="h-4 w-4" />
                    Open ESPN Fantasy
                  </Button>
                </div>
              </div>
            </div>

            <div className="border rounded-lg p-4 bg-accent/5">
              <div className="flex items-start gap-3">
                <div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                  <span className="text-sm font-bold">2</span>
                </div>
                <div className="space-y-2 flex-1">
                  <h3 className="font-semibold">Open Developer Tools</h3>
                  <p className="text-sm text-muted-foreground">Press one of these keyboard shortcuts:</p>
                  <div className="flex gap-2 flex-wrap">
                    <code className="px-2 py-1 bg-secondary rounded text-sm">F12</code>
                    <code className="px-2 py-1 bg-secondary rounded text-sm">Ctrl + Shift + I</code>
                    <code className="px-2 py-1 bg-secondary rounded text-sm">Cmd + Option + I (Mac)</code>
                  </div>
                </div>
              </div>
            </div>

            <div className="border rounded-lg p-4 bg-accent/5">
              <div className="flex items-start gap-3">
                <div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                  <span className="text-sm font-bold">3</span>
                </div>
                <div className="space-y-2 flex-1">
                  <h3 className="font-semibold">Find Cookies</h3>
                  <p className="text-sm text-muted-foreground">
                    In Developer Tools, navigate to:
                  </p>
                  <div className="space-y-1 text-sm">
                    <p className="font-mono bg-secondary px-2 py-1 rounded">
                      Application → Storage → Cookies → fantasy.espn.com
                    </p>
                    <p className="text-muted-foreground text-xs">
                      (On Firefox: Storage → Cookies)
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="border rounded-lg p-4 bg-accent/5">
              <div className="flex items-start gap-3">
                <div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                  <span className="text-sm font-bold">4</span>
                </div>
                <div className="space-y-3 flex-1">
                  <h3 className="font-semibold">Copy Cookie Values</h3>
                  
                  <div className="space-y-2">
                    <div className="border-l-2 border-primary pl-3">
                      <p className="font-medium text-sm">espn_s2 Cookie:</p>
                      <p className="text-xs text-muted-foreground">
                        Look for a row named <code className="bg-secondary px-1 rounded">espn_s2</code>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Double-click the value column to select, then copy the entire string (usually very long)
                      </p>
                    </div>

                    <div className="border-l-2 border-primary pl-3">
                      <p className="font-medium text-sm">SWID Cookie:</p>
                      <p className="text-xs text-muted-foreground">
                        Look for a row named <code className="bg-secondary px-1 rounded">SWID</code>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Copy the value (looks like: {"{"}ABC123-DEF456{"}"})
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="border rounded-lg p-4 bg-accent/5">
              <div className="flex items-start gap-3">
                <div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                  <span className="text-sm font-bold">5</span>
                </div>
                <div className="space-y-2 flex-1">
                  <h3 className="font-semibold">Get League ID</h3>
                  <p className="text-sm text-muted-foreground">
                    Look at your browser's URL bar. The League ID is the number in the URL:
                  </p>
                  <div className="bg-secondary p-2 rounded text-xs font-mono break-all">
                    fantasy.espn.com/football/league?leagueId=<span className="bg-primary/20 px-1">123456</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Copy just the number after <code>leagueId=</code>
                  </p>
                </div>
              </div>
            </div>
          </div>

          <Alert className="bg-green-50 border-green-200">
            <CheckCircle className="h-4 w-4 text-green-600" />
            <AlertDescription className="text-green-800">
              Once you have all three values, paste them into the form and click "Connect ESPN"
            </AlertDescription>
          </Alert>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function ConnectLeague() {
  const [sleeperUsername, setSleeperUsername] = useState("");
  const [espnCredentials, setEspnCredentials] = useState({ espn_s2: "", swid: "", leagueId: "" });
  const [isLoading, setIsLoading] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [fieldsFilled, setFieldsFilled] = useState({ espn_s2: false, swid: false, leagueId: false });
  const { toast } = useToast();
  const navigate = useNavigate();

  // Track field completion
  useEffect(() => {
    setFieldsFilled({
      espn_s2: espnCredentials.espn_s2.length >= 10,
      swid: espnCredentials.swid.length >= 5,
      leagueId: espnCredentials.leagueId.length >= 1,
    });
  }, [espnCredentials]);

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

  const handleEspnConnect = async () => {
    // Validate inputs with zod schema
    const validationResult = espnSchema.safeParse({
      leagueId: espnCredentials.leagueId,
      espn_s2: espnCredentials.espn_s2,
      swid: espnCredentials.swid,
    });
    
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
      // Explicitly refresh the session to ensure we have a valid token
      const { data: { session }, error: refreshError } = await supabase.auth.refreshSession();
      
      if (refreshError || !session) {
        throw new Error('Your session has expired. Please log out and log back in.');
      }

      const { data, error } = await supabase.functions.invoke('sync-espn-league', {
        body: validationResult.data,
      });

      if (error) throw error;

      toast({
        title: "✅ League Connected!",
        description: data.message || "Your ESPN league has been synced. Griddy is analyzing your roster now!",
      });

      setTimeout(() => navigate('/'), 2000);
    } catch (error: any) {
      const errorMsg = error.message?.includes('authenticate') 
        ? "Unable to authenticate. Please check your espn_s2 and SWID cookies are correct."
        : error.message?.includes('team')
        ? "Unable to find your team in this league. Please verify the League ID."
        : "Unable to connect your ESPN league. Please verify your credentials and try again.";
      
      toast({
        title: "Connection Failed",
        description: errorMsg,
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
                <CardDescription>One-time setup - your credentials are encrypted</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Step-by-step Progress */}
                <div className="space-y-2 p-3 bg-accent/5 rounded-lg">
                  <div className="flex items-center gap-2 text-sm">
                    <div className={`h-5 w-5 rounded-full flex items-center justify-center ${
                      fieldsFilled.espn_s2 ? 'bg-green-500' : 'bg-secondary'
                    }`}>
                      {fieldsFilled.espn_s2 ? (
                        <CheckCircle className="h-3 w-3 text-white" />
                      ) : (
                        <span className="text-xs">1</span>
                      )}
                    </div>
                    <span className={fieldsFilled.espn_s2 ? 'text-foreground' : 'text-muted-foreground'}>
                      espn_s2 cookie
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <div className={`h-5 w-5 rounded-full flex items-center justify-center ${
                      fieldsFilled.swid ? 'bg-green-500' : 'bg-secondary'
                    }`}>
                      {fieldsFilled.swid ? (
                        <CheckCircle className="h-3 w-3 text-white" />
                      ) : (
                        <span className="text-xs">2</span>
                      )}
                    </div>
                    <span className={fieldsFilled.swid ? 'text-foreground' : 'text-muted-foreground'}>
                      SWID cookie
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <div className={`h-5 w-5 rounded-full flex items-center justify-center ${
                      fieldsFilled.leagueId ? 'bg-green-500' : 'bg-secondary'
                    }`}>
                      {fieldsFilled.leagueId ? (
                        <CheckCircle className="h-3 w-3 text-white" />
                      ) : (
                        <span className="text-xs">3</span>
                      )}
                    </div>
                    <span className={fieldsFilled.leagueId ? 'text-foreground' : 'text-muted-foreground'}>
                      League ID
                    </span>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="espn-s2" className="flex items-center gap-2">
                    espn_s2 Cookie
                    {fieldsFilled.espn_s2 && <CheckCircle className="h-4 w-4 text-green-500" />}
                  </Label>
                  <Input
                    id="espn-s2"
                    type="password"
                    placeholder="Long alphanumeric string..."
                    value={espnCredentials.espn_s2}
                    onChange={(e) => setEspnCredentials({...espnCredentials, espn_s2: e.target.value})}
                    className={fieldsFilled.espn_s2 ? 'border-green-500' : ''}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="swid" className="flex items-center gap-2">
                    SWID Cookie
                    {fieldsFilled.swid && <CheckCircle className="h-4 w-4 text-green-500" />}
                  </Label>
                  <Input
                    id="swid"
                    placeholder="{ABC123-DEF456}"
                    value={espnCredentials.swid}
                    onChange={(e) => setEspnCredentials({...espnCredentials, swid: e.target.value})}
                    className={fieldsFilled.swid ? 'border-green-500' : ''}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="league-id" className="flex items-center gap-2">
                    League ID
                    {fieldsFilled.leagueId && <CheckCircle className="h-4 w-4 text-green-500" />}
                  </Label>
                  <Input
                    id="league-id"
                    placeholder="123456"
                    value={espnCredentials.leagueId}
                    onChange={(e) => setEspnCredentials({...espnCredentials, leagueId: e.target.value})}
                    className={fieldsFilled.leagueId ? 'border-green-500' : ''}
                  />
                  <p className="text-xs text-muted-foreground">
                    Found in your league URL after <code className="bg-secondary px-1 rounded">leagueId=</code>
                  </p>
                </div>

                <EspnCookieHelper />

                <Button 
                  onClick={handleEspnConnect} 
                  disabled={isLoading || !fieldsFilled.espn_s2 || !fieldsFilled.swid || !fieldsFilled.leagueId}
                  className="w-full"
                  variant="glow"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Syncing League...
                    </>
                  ) : (
                    '🔗 Connect ESPN League'
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