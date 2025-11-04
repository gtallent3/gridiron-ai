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
  const [yahooAuthUrl, setYahooAuthUrl] = useState<string | null>(null);
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

    // Handle Yahoo OAuth callback
    const handleYahooCallback = async () => {
      const urlParams = new URLSearchParams(window.location.search);
      const code = urlParams.get('code');
      const state = urlParams.get('state');
      
      if (code && window.location.pathname === '/connect-league') {
        // Validate state if present
        const savedState = sessionStorage.getItem('yahoo_oauth_state');
        if (state && savedState && state !== savedState) {
          toast({
            title: "Security Error",
            description: "Invalid OAuth state. Please try connecting again.",
            variant: "destructive",
          });
          window.history.replaceState({}, '', '/connect-league');
          return;
        }
        sessionStorage.removeItem('yahoo_oauth_state');

        setIsLoading(true);
        try {
          const { data: { session } } = await supabase.auth.getSession();
          if (!session) {
            throw new Error('Not authenticated');
          }

          console.log('Processing Yahoo OAuth callback with code...');

          // Exchange code for tokens
          const { data: tokenData, error: tokenError } = await supabase.functions.invoke(
            'validate-yahoo-oauth',
            {
              body: { code },
            }
          );

          if (tokenError) throw tokenError;

          console.log('Token exchange successful, processing league data...');
          console.log('Full tokenData:', JSON.stringify(tokenData, null, 2));

          // Get list of leagues from the games data
          const games = tokenData.gamesData?.fantasy_content?.users?.[0]?.user?.[1]?.games;
          console.log('Games data:', JSON.stringify(games, null, 2));
          
          if (!games) {
            throw new Error('No NFL leagues found in Yahoo account');
          }

          // Find current season NFL game (try current year and previous year for ongoing season)
          const currentYear = new Date().getFullYear();
          const possibleSeasons = [currentYear.toString(), (currentYear - 1).toString()];
          
          console.log('Looking for NFL seasons:', possibleSeasons);
          
          let nflGame: any = null;
          let selectedGameObj: any = null;
          let leaguesObj: any = null;

          const gameItems = Object.values(games) as any[];
          for (const season of possibleSeasons) {
            for (const item of gameItems) {
              const gameArr = item?.game;
              if (!Array.isArray(gameArr)) continue;
              const gameObj = Object.assign({}, ...gameArr);
              const gameCode = gameObj?.code;
              const gameSeason = gameObj?.season;
              const leagues = gameObj?.leagues;
              const leaguesCount = typeof leagues?.count !== 'undefined' ? leagues.count : (leagues ? Object.keys(leagues).length - (leagues.count ? 1 : 0) : 0);
              console.log('Checking game:', gameCode, 'season:', gameSeason, 'leaguesCount:', leaguesCount);
              if (gameCode === 'nfl' && gameSeason === season) {
                nflGame = item;
                selectedGameObj = gameObj;
                leaguesObj = leagues;
                console.log('Found NFL game for season:', season);
                break;
              }
            }
            if (nflGame) break;
          }

          if (!nflGame || !selectedGameObj) {
            const available = gameItems.map((g: any) => {
              const obj = Object.assign({}, ...(Array.isArray(g?.game) ? g.game : []));
              return { code: obj?.code, season: obj?.season };
            });
            console.error('No NFL game found. Available games:', available);
            throw new Error('No current or recent season NFL leagues found in your Yahoo account');
          }

          console.log('NFL Game object:', selectedGameObj);

          // Extract league keys robustly
          const leagueKeys: string[] = [];
          const leagueNames: { key: string; name: string }[] = [];
          if (leaguesObj && typeof leaguesObj === 'object') {
            for (const [k, v] of Object.entries(leaguesObj)) {
              if (k === 'count') continue;
              const leagueData = (v as any)?.league?.[0];
              const key = leagueData?.league_key;
              const name = leagueData?.name;
              if (key && name) {
                leagueKeys.push(key);
                leagueNames.push({ key, name });
              }
            }
          }

          console.log('Extracted league keys:', leagueKeys);
          console.log('Available leagues:', leagueNames);

          if (leagueKeys.length === 0) {
            throw new Error('No leagues found on this Yahoo account. Please make sure you:\n1. Are logged into the correct Yahoo account\n2. Have joined a league with this account\n3. Have an active NFL fantasy league for this season');
          }

          // If multiple leagues, sync all of them
          if (leagueKeys.length > 1) {
            let successCount = 0;
            let failCount = 0;
            
            for (const { key, name } of leagueNames) {
              try {
                console.log('Syncing league:', name, key);
                const { error: syncError } = await supabase.functions.invoke(
                  'sync-yahoo-league',
                  {
                    body: {
                      leagueKey: key,
                      tokenData: tokenData.tokenData,
                    },
                  }
                );

                if (syncError) {
                  console.error(`Failed to sync ${name}:`, syncError);
                  failCount++;
                } else {
                  console.log(`Successfully synced ${name}`);
                  successCount++;
                }
              } catch (err) {
                console.error(`Error syncing ${name}:`, err);
                failCount++;
              }
            }

            if (successCount > 0) {
              toast({
                title: "✅ Yahoo Leagues Connected!",
                description: `${successCount} league(s) synced successfully${failCount > 0 ? `, ${failCount} failed` : ''}!`,
              });
            } else {
              throw new Error('Failed to sync any leagues');
            }
          } else {
            // Single league - sync it
            const leagueKey = leagueKeys[0];
            console.log('Syncing single league with key:', leagueKey);

            const { data: syncData, error: syncError } = await supabase.functions.invoke(
              'sync-yahoo-league',
              {
                body: {
                  leagueKey,
                  tokenData: tokenData.tokenData,
                },
              }
            );

            if (syncError) throw syncError;

            toast({
              title: "✅ Yahoo League Connected!",
              description: `${syncData.league.name} has been synced successfully!`,
            });
          }

          // If we're in a popup, close it and notify parent
          if (window.opener) {
            window.opener.postMessage({ type: 'yahoo-oauth-success' }, window.location.origin);
            window.close();
          } else {
            // Clear URL params and redirect
            window.history.replaceState({}, '', '/connect-league');
            setTimeout(() => navigate('/'), 2000);
          }
        } catch (error: any) {
          console.error('Yahoo OAuth error:', error);
          toast({
            title: "Connection Failed",
            description: error.message || "Unable to connect Yahoo league. Please try again.",
            variant: "destructive",
          });
          
          if (window.opener) {
            window.opener.postMessage({ type: 'yahoo-oauth-error', error: error.message }, window.location.origin);
            window.close();
          } else {
            window.history.replaceState({}, '', '/connect-league');
          }
        } finally {
          setIsLoading(false);
        }
      }
    };

    handleYahooCallback();

    // Listen for OAuth success from popup
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      
      if (event.data.type === 'yahoo-oauth-success') {
        toast({
          title: "✅ Yahoo League Connected!",
          description: "Your league has been synced successfully!",
        });
        setTimeout(() => navigate('/'), 2000);
      } else if (event.data.type === 'yahoo-oauth-error') {
        toast({
          title: "Connection Failed",
          description: event.data.error || "Unable to connect Yahoo league.",
          variant: "destructive",
        });
      }
    };

    window.addEventListener('message', handleMessage);

    return () => {
      subscription.unsubscribe();
      window.removeEventListener('message', handleMessage);
    };
  }, [navigate, toast]);

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

  const handleYahooConnect = () => {
    // Build Yahoo OAuth URL (Client ID is public by design)
    const clientId = 'dj0yJmk9VDYxV3huOTdXN25UJmQ9WVdrOWN6Qk1ORWN5TmxVbWNHbzlNQT09JnM9Y29uc3VtZXJzZWNyZXQmc3Y9MCZ4PWQ0';
    const redirect = `${window.location.origin}/connect-league`;
    const redirectUri = encodeURIComponent(redirect);
    const scope = encodeURIComponent('fspt-r');
    const state = crypto.getRandomValues(new Uint32Array(1))[0].toString(16);
    sessionStorage.setItem('yahoo_oauth_state', state);
    // Add prompt=login to force Yahoo to show login screen every time
    const authUrl = `https://api.login.yahoo.com/oauth2/request_auth?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=${scope}&state=${state}&prompt=login`;

    setYahooAuthUrl(authUrl);

    console.log('Opening Yahoo OAuth URL:', authUrl);
    console.log('Redirect URI:', redirect);
    console.log('Is in iframe:', window.self !== window.top);

    // Always open in a new tab to avoid iframe/X-Frame-Options issues in preview
    const newTab = window.open(authUrl, '_blank', 'noopener,noreferrer');
    if (!newTab || newTab.closed || typeof newTab.closed === 'undefined') {
      toast({
        title: "Opening Yahoo in a new tab",
        description: "If nothing opens, please allow popups or click the manual link below.",
      });
      const a = document.createElement('a');
      a.href = authUrl;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      document.body.appendChild(a);
      a.click();
      a.remove();
    } else {
      console.log('New tab opened successfully');
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

          <div className="grid md:grid-cols-2 gap-6 max-w-3xl mx-auto">
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
                <div className="bg-primary/10 border border-primary/30 rounded-lg p-3 text-sm">
                  <div className="flex items-start gap-2">
                    <span className="text-primary">💡</span>
                    <div className="text-muted-foreground">
                      <strong className="text-foreground">Recommended:</strong> Use a desktop or laptop for easier ESPN setup. Mobile works but requires extra steps.
                    </div>
                  </div>
                </div>
                
                <div className="rounded-lg overflow-hidden border border-border">
                  <video 
                    className="w-full"
                    controls
                    preload="metadata"
                  >
                    <source src="/Set_Up_ESPN.mp4" type="video/mp4" />
                    Your browser does not support the video tag.
                  </video>
                </div>

                <div className="text-center py-4">
                  <EspnCookieExtractor onSuccess={handleEspnCookieSuccess} />
                  <p className="text-sm text-muted-foreground mt-3">
                    Guided setup with platform-specific instructions
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* Yahoo Card */}
            <Card className="border-2 border-primary/50">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <div className="h-10 w-10 rounded-full bg-purple-500/20 flex items-center justify-center">
                    <span className="text-xl font-bold">Y</span>
                  </div>
                  Yahoo
                </CardTitle>
                <CardDescription>OAuth secure connection</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-3 text-sm">
                  <div className="flex items-start gap-2">
                    <span>🔒</span>
                    <div className="text-muted-foreground">
                      <strong className="text-foreground">Secure OAuth:</strong> You'll be redirected to Yahoo to authorize access. We never see your Yahoo password.
                    </div>
                  </div>
                </div>
                
                <Button 
                  onClick={handleYahooConnect}
                  disabled={isLoading}
                  className="w-full bg-purple-600 hover:bg-purple-700"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Connecting...
                    </>
                  ) : (
                    'Connect Yahoo'
                  )}
                </Button>
                {yahooAuthUrl && (
                  <div className="text-xs text-muted-foreground text-center mt-2 space-y-1">
                    <p>
                      Having trouble?{' '}
                      <a href={yahooAuthUrl} target="_blank" rel="noopener noreferrer" className="underline">
                        Click here to open Yahoo auth
                      </a>
                    </p>
                    <div className="flex items-center justify-center gap-2">
                      <button
                        className="underline"
                        onClick={() => navigator.clipboard.writeText(yahooAuthUrl)}
                      >
                        Copy auth link
                      </button>
                      <span className="opacity-70">then paste in a new browser window</span>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
