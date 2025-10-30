import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ExternalLink, Copy, Check, AlertCircle, Cookie, Smartphone, Monitor } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface EspnCookieExtractorProps {
  onSuccess: (credentials: { swid: string; espn_s2: string; leagueId: string }) => void;
}

export function EspnCookieExtractor({ onSuccess }: EspnCookieExtractorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [step, setStep] = useState<'intro' | 'extract' | 'validate'>('intro');
  const [swid, setSwid] = useState('');
  const [espn_s2, setEspn_s2] = useState('');
  const [leagueId, setLeagueId] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  const [copiedStep, setCopiedStep] = useState<number | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    const checkMobile = () => {
      const mobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
      setIsMobile(mobile);
    };
    checkMobile();
  }, []);

  // Listen for postMessage from bookmarklet
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const msg = e.data;
      if (msg && msg.__GRIDIRONGM === 'ESPN_COOKIES') {
        setSwid(msg.data.SWID || '');
        setEspn_s2(msg.data.espn_s2 || '');
        setStep('validate');
        toast({
          title: "Cookies captured!",
          description: "Auto-filled your ESPN credentials. Add your League ID to continue.",
        });
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [toast]);

  const extractionScript = `
// Paste this in ESPN's browser console
var cookies = document.cookie.split(';');
var espnCreds = {};
cookies.forEach(c => {
  if (c.includes('SWID=')) espnCreds.swid = c.split('=')[1].trim();
  if (c.includes('espn_s2=')) espnCreds.espn_s2 = c.split('=')[1].trim();
});
console.log('Copy these values:', espnCreds);
espnCreds;`.trim();

  const bookmarkletCode = `javascript:(async()=>{try{const need=['SWID','espn_s2'];const jar=Object.fromEntries(document.cookie.split('; ').map(s=>s.split('=')));const out={};need.forEach(k=>{if(jar[k])out[k]=decodeURIComponent(jar[k]);});if(Object.keys(out).length<2){alert('Could not find both SWID and espn_s2. Make sure you are logged into ESPN.');return;}alert('Found cookies! Returning to GridironGM...');window.opener?.postMessage({__GRIDIRONGM:'ESPN_COOKIES',data:out},'*');}catch(e){alert('Failed to capture cookies: '+e);}})();`;

  const openEspnLogin = () => {
    window.open('https://www.espn.com/login', '_blank', 'width=800,height=600');
    setStep('extract');
  };

  const copyScript = () => {
    const textToCopy = isMobile ? bookmarkletCode : extractionScript;
    navigator.clipboard.writeText(textToCopy);
    toast({
      title: isMobile ? "Bookmarklet copied!" : "Script copied!",
      description: isMobile ? "Follow the instructions to save as bookmark" : "Paste it in ESPN's browser console (F12)",
    });
  };

  const copyToClipboard = (text: string, stepNum: number) => {
    navigator.clipboard.writeText(text);
    setCopiedStep(stepNum);
    setTimeout(() => setCopiedStep(null), 2000);
  };

  const handleValidate = async () => {
    if (!swid || !espn_s2 || !leagueId) {
      toast({
        title: "Missing information",
        description: "Please fill in all fields",
        variant: "destructive",
      });
      return;
    }

    setIsValidating(true);
    try {
      const { data, error } = await supabase.functions.invoke('validate-espn-credentials', {
        body: { swid, espn_s2, leagueId }
      });

      if (error) throw error;

      if (data.success) {
        toast({
          title: "Credentials validated!",
          description: `Connected to ${data.leagueName}. Expires: ${new Date(data.expiresAt).toLocaleDateString()}`,
        });
        onSuccess({ swid, espn_s2, leagueId });
        setIsOpen(false);
        resetState();
      }
    } catch (error) {
      console.error('Validation error:', error);
      toast({
        title: "Validation failed",
        description: error.message || "Invalid credentials or league ID",
        variant: "destructive",
      });
    } finally {
      setIsValidating(false);
    }
  };

  const resetState = () => {
    setStep('intro');
    setSwid('');
    setEspn_s2('');
    setLeagueId('');
  };

  return (
    <>
      <Button onClick={() => setIsOpen(true)} size="lg" className="gap-2">
        <Cookie className="h-5 w-5" />
        Sign in with ESPN
      </Button>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Cookie className="h-6 w-6" />
              ESPN Cookie Extraction
            </DialogTitle>
            <DialogDescription>
              Securely capture your ESPN session to enable automatic league sync
            </DialogDescription>
          </DialogHeader>

          {step === 'intro' && (
            <div className="space-y-4">
              <Alert>
                <div className="flex items-center gap-2">
                  {isMobile ? <Smartphone className="h-4 w-4" /> : <Monitor className="h-4 w-4" />}
                  <AlertCircle className="h-4 w-4" />
                </div>
                <AlertDescription>
                  {isMobile ? "Mobile device detected! " : "Desktop device detected! "}
                  Due to browser security, we can't automatically capture ESPN cookies. 
                  This quick 3-step process takes less than 1 minute.
                  <Button 
                    variant="link" 
                    className="p-0 h-auto ml-1"
                    onClick={() => window.open('/BROWSER_EXTENSION_GUIDE.md', '_blank')}
                  >
                    Why not fully automated?
                  </Button>
                </AlertDescription>
              </Alert>

              <div className="space-y-3">
                <div className="flex items-start gap-3 p-3 border rounded-lg">
                  <div className="h-6 w-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-semibold flex-shrink-0">1</div>
                  <div>
                    <h4 className="font-medium">Login to ESPN</h4>
                    <p className="text-sm text-muted-foreground">We'll open ESPN in a new tab</p>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-3 border rounded-lg">
                  <div className="h-6 w-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-semibold flex-shrink-0">2</div>
                  <div>
                    <h4 className="font-medium">Extract cookies</h4>
                    <p className="text-sm text-muted-foreground">
                      {isMobile ? "Tap a bookmark on ESPN's page" : "Run a script in browser console"}
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-3 border rounded-lg">
                  <div className="h-6 w-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-semibold flex-shrink-0">3</div>
                  <div>
                    <h4 className="font-medium">Paste & sync</h4>
                    <p className="text-sm text-muted-foreground">Paste values and we'll handle the rest</p>
                  </div>
                </div>
              </div>

              <Button onClick={openEspnLogin} className="w-full gap-2">
                <ExternalLink className="h-4 w-4" />
                Open ESPN Login
              </Button>
            </div>
          )}

          {step === 'extract' && !isMobile && (
            <div className="space-y-4">
              <Alert>
                <Monitor className="h-4 w-4" />
                <AlertDescription>
                  Use the bookmarklet for one-click auto-fill, or use DevTools for manual extraction
                </AlertDescription>
              </Alert>

              <div className="space-y-4">
                <div className="space-y-3 p-4 border rounded-lg bg-primary/5">
                  <Label className="text-base font-semibold">⚡ Quick Setup (3 steps)</Label>
                  
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs">1</span>
                      Copy the bookmarklet code
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        onClick={copyScript}
                        className="gap-2"
                      >
                        <Copy className="h-4 w-4" />
                        Copy Bookmarklet Code
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs">2</span>
                      Create a new bookmark
                    </div>
                    <ul className="text-xs text-muted-foreground space-y-1 ml-7">
                      <li>• Chrome/Edge: Press Ctrl+D (or Cmd+D on Mac)</li>
                      <li>• Or right-click your bookmarks bar → "Add page"</li>
                      <li>• Name it "Get ESPN Cookies"</li>
                    </ul>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs">3</span>
                      Paste code as URL
                    </div>
                    <p className="text-xs text-muted-foreground ml-7">
                      Edit the bookmark, delete the URL, and paste the code you copied in step 1
                    </p>
                  </div>

                  <Alert className="mt-3">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription className="text-xs">
                      <strong>Don't see bookmarks bar?</strong> Press Ctrl+Shift+B (or Cmd+Shift+B on Mac) to show it
                    </AlertDescription>
                  </Alert>
                </div>

                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-background px-2 text-muted-foreground">Or use console</span>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Console method (F12 → Console tab)</Label>
                  <div className="relative">
                    <pre className="bg-muted p-3 rounded text-xs overflow-x-auto">
                      {extractionScript}
                    </pre>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="absolute top-2 right-2"
                      onClick={() => {
                        navigator.clipboard.writeText(extractionScript);
                        toast({ title: "Script copied!", description: "Paste in ESPN console (F12)" });
                      }}
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>

              <Button onClick={() => setStep('validate')} variant="outline" className="w-full">
                Continue to manual entry
              </Button>
            </div>
          )}

          {step === 'extract' && isMobile && (
            <div className="space-y-4">
              <Alert>
                <Smartphone className="h-4 w-4" />
                <AlertDescription>
                  Mobile browsers don't have DevTools. We'll use a bookmarklet with auto-fill!
                </AlertDescription>
              </Alert>

              <div className="space-y-4">
                <div className="space-y-2">
                  <Label className="text-base font-semibold">Step 1: Copy the bookmarklet code</Label>
                  <div className="relative">
                    <pre className="bg-muted p-3 rounded text-xs overflow-x-auto break-all">
                      {bookmarkletCode}
                    </pre>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="absolute top-2 right-2"
                      onClick={copyScript}
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                <div className="space-y-2 p-3 border rounded-lg bg-muted/50">
                  <Label className="text-base font-semibold">Step 2: Create a bookmark</Label>
                  <ol className="text-sm space-y-2 list-decimal list-inside text-muted-foreground">
                    <li>Bookmark any page (tap share → Add to Bookmarks)</li>
                    <li>Edit the bookmark and replace the URL with the code you copied</li>
                    <li>Name it "Get ESPN Cookies"</li>
                  </ol>
                </div>

                <div className="space-y-2 p-3 border rounded-lg bg-muted/50">
                  <Label className="text-base font-semibold">Step 3: Use the bookmarklet</Label>
                  <ol className="text-sm space-y-2 list-decimal list-inside text-muted-foreground">
                    <li>Go to fantasy.espn.com and log in</li>
                    <li>Tap the bookmarks icon and select "Get ESPN Cookies"</li>
                    <li>You'll see an alert confirming cookies were found</li>
                    <li>Your SWID and espn_s2 will auto-fill here!</li>
                  </ol>
                </div>
              </div>

              <Button onClick={() => setStep('validate')} variant="outline" className="w-full">
                Skip to manual entry
              </Button>
            </div>
          )}

          {step === 'validate' && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="swid">SWID</Label>
                <div className="flex gap-2">
                  <Input
                    id="swid"
                    placeholder="{XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX}"
                    value={swid}
                    onChange={(e) => setSwid(e.target.value.trim())}
                  />
                  <Button
                    size="icon"
                    variant="outline"
                    onClick={() => copyToClipboard(swid, 1)}
                  >
                    {copiedStep === 1 ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="espn_s2">ESPN S2</Label>
                <div className="flex gap-2">
                  <Input
                    id="espn_s2"
                    placeholder="Long alphanumeric string..."
                    value={espn_s2}
                    onChange={(e) => setEspn_s2(e.target.value.trim())}
                  />
                  <Button
                    size="icon"
                    variant="outline"
                    onClick={() => copyToClipboard(espn_s2, 2)}
                  >
                    {copiedStep === 2 ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="leagueId">League ID</Label>
                <Input
                  id="leagueId"
                  placeholder="Your ESPN League ID"
                  value={leagueId}
                  onChange={(e) => setLeagueId(e.target.value.trim())}
                />
                <p className="text-xs text-muted-foreground">
                  Find this in your league URL: .../leagueId/<strong>123456</strong>
                </p>
              </div>

              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  Your credentials are encrypted and stored securely. They expire in 90 days.
                </AlertDescription>
              </Alert>

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => setStep('extract')}
                  className="flex-1"
                >
                  Back
                </Button>
                <Button
                  onClick={handleValidate}
                  disabled={isValidating || !swid || !espn_s2 || !leagueId}
                  className="flex-1"
                >
                  {isValidating ? 'Validating...' : 'Validate & Connect'}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}