import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ExternalLink, Copy, Check, AlertCircle, Cookie, Smartphone, Monitor } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { BookmarkletDragDemo } from "@/components/BookmarkletDragDemo";
import { BookmarkletClickDemo } from "@/components/BookmarkletClickDemo";
import { BookmarkletCopyDemo, BookmarkletSaveDemo, BookmarkletMobileClickDemo } from "@/components/BookmarkletMobileDemos";

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
        setLeagueId(msg.data.leagueId || '');
        setStep('validate');
        const hasLeagueId = msg.data.leagueId ? "League ID auto-detected!" : "Add your League ID to continue.";
        toast({
          title: "Cookies captured!",
          description: hasLeagueId,
        });
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [toast]);

  // Auto-paste from clipboard when validate step opens and fields are empty
  useEffect(() => {
    if (step === 'validate' && !swid && !espn_s2) {
      handleClipboardPaste();
    }
  }, [step]);

  // Handle manual paste from clipboard fallback
  const handleClipboardPaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      const parsed = JSON.parse(text);
      if (parsed.SWID && parsed.espn_s2) {
        setSwid(parsed.SWID);
        setEspn_s2(parsed.espn_s2);
        setLeagueId(parsed.leagueId || '');
        setStep('validate');
        const leagueMsg = parsed.leagueId ? " League ID detected!" : " Add your League ID to continue.";
        toast({
          title: "Cookies loaded!",
          description: "Credentials pasted from clipboard." + leagueMsg,
        });
      }
    } catch (error) {
      toast({
        title: "Paste failed",
        description: "Could not read credentials from clipboard",
        variant: "destructive",
      });
    }
  };

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

  const bookmarkletCode = `javascript:(async()=>{try{const need=['SWID','espn_s2'];const jar={};document.cookie.split('; ').forEach(c=>{const idx=c.indexOf('=');if(idx>0){const k=c.substring(0,idx);const v=c.substring(idx+1);jar[k]=v;}});const out={};need.forEach(k=>{if(jar[k])out[k]=jar[k];});if(Object.keys(out).length<2){alert('Could not find both SWID and espn_s2. Make sure you are logged into ESPN.');return;}const urlMatch=window.location.href.match(/leagueId[=/](\\d+)/);if(urlMatch){out.leagueId=urlMatch[1];}if(window.opener){window.opener.postMessage({__GRIDIRONGM:'ESPN_COOKIES',data:out},'*');window.opener.focus();const leagueMsg=out.leagueId?' League ID detected!':'';alert('Cookies sent!'+leagueMsg+' You can close this window and return to GridironGM.');window.close();}else{navigator.clipboard.writeText(JSON.stringify(out));const leagueMsg=out.leagueId?' League ID detected!':'';alert('Cookies copied to clipboard!'+leagueMsg+' Close this window and paste in GridironGM.');}}catch(e){alert('Failed to capture cookies: '+e);}})();`;

  const goToExtractStep = () => {
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
                    <p className="text-sm text-muted-foreground">Go to fantasy.espn.com and sign in, then navigate to your league page</p>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-3 border rounded-lg">
                  <div className="h-6 w-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-semibold flex-shrink-0">2</div>
                  <div>
                    <h4 className="font-medium">Extract cookies & league ID</h4>
                    <p className="text-sm text-muted-foreground">
                      {isMobile ? "Use a bookmarklet on your league page to auto-detect everything" : "Use a bookmarklet or console script on your league page"}
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-3 border rounded-lg">
                  <div className="h-6 w-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-semibold flex-shrink-0">3</div>
                  <div>
                    <h4 className="font-medium">Auto-fill & sync</h4>
                    <p className="text-sm text-muted-foreground">Credentials and league ID will auto-fill, then click validate</p>
                  </div>
                </div>
              </div>

              <Button onClick={goToExtractStep} className="w-full gap-2">
                <ExternalLink className="h-4 w-4" />
                Continue to Setup
              </Button>
            </div>
          )}

          {step === 'extract' && !isMobile && (
            <div className="space-y-4">
              <Alert>
                <Monitor className="h-4 w-4" />
                <AlertDescription>
                  Make sure you're on your ESPN league page (URL contains leagueId) before using the bookmarklet - it will auto-detect your League ID!
                </AlertDescription>
              </Alert>

              <div className="space-y-3 p-3 border rounded-lg bg-primary/5">
                <Label className="text-base font-semibold flex items-center gap-2">
                  ⚡ Method 1: Drag to bookmarks bar
                </Label>
                
                <BookmarkletDragDemo />
                
                <div className="flex items-center gap-2">
                  <a
                    href={bookmarkletCode}
                    className="px-3 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/90 text-sm font-medium cursor-move inline-block"
                    draggable="true"
                  >
                    📋 Get ESPN Cookies
                  </a>
                </div>
                <p className="text-xs text-muted-foreground">
                  Drag the button above to your bookmarks bar, then use it on your ESPN league page
                </p>
              </div>

              <div className="space-y-3 p-3 border rounded-lg bg-muted/50">
                <Label className="text-base font-semibold">
                  🖱️ Step 2: Use the bookmarklet
                </Label>
                <BookmarkletClickDemo />
                <p className="text-xs text-muted-foreground">
                  Navigate to your ESPN league page, then click the bookmarklet in your bookmarks bar. It will auto-detect your League ID and send the data back here.
                </p>
              </div>

              <Button onClick={() => setStep('validate')} variant="outline" className="w-full">
                Having trouble? Continue to manual entry
              </Button>
            </div>
          )}

          {step === 'extract' && isMobile && (
            <div className="space-y-4">
              <Alert>
                <Smartphone className="h-4 w-4" />
                <AlertDescription>
                  Navigate to your ESPN league page first - the bookmarklet will auto-detect your League ID from the URL!
                </AlertDescription>
              </Alert>

              <div className="space-y-3">
                <div className="space-y-2 p-3 border rounded-lg bg-primary/5">
                  <Label className="text-base font-semibold">
                    📋 Step 1: Copy the bookmarklet code
                  </Label>
                  <BookmarkletCopyDemo />
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
                  <Label className="text-base font-semibold">
                    🔖 Step 2: Create a bookmark
                  </Label>
                  <BookmarkletSaveDemo />
                  <ol className="text-xs space-y-1 list-decimal list-inside text-muted-foreground">
                    <li>Bookmark any page (tap share → Add to Bookmarks)</li>
                    <li>Edit the bookmark and replace the URL with the code you copied</li>
                    <li>Name it "Get ESPN Cookies"</li>
                  </ol>
                </div>

                <div className="space-y-2 p-3 border rounded-lg bg-muted/50">
                  <Label className="text-base font-semibold">
                    📱 Step 3: Use on ESPN
                  </Label>
                  <BookmarkletMobileClickDemo />
                  <ol className="text-xs space-y-1 list-decimal list-inside text-muted-foreground">
                    <li>Go to fantasy.espn.com and log in</li>
                    <li>Navigate to your league page (URL should contain leagueId)</li>
                    <li>Tap the bookmarks icon and select "Get ESPN Cookies"</li>
                    <li>Your credentials will auto-fill here!</li>
                  </ol>
                </div>
              </div>

              <Button onClick={() => setStep('validate')} variant="outline" className="w-full">
                Having trouble? Continue to manual entry
              </Button>
            </div>
          )}

          {step === 'validate' && (
            <div className="space-y-4">
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  If the bookmarklet didn't auto-fill, you can paste from clipboard or enter manually.
                </AlertDescription>
              </Alert>

              <Button
                onClick={handleClipboardPaste}
                variant="outline"
                className="w-full gap-2"
              >
                <Copy className="h-4 w-4" />
                Paste Cookies from Clipboard
              </Button>

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
                  placeholder="Auto-detected from ESPN URL (or enter manually)"
                  value={leagueId}
                  onChange={(e) => setLeagueId(e.target.value.trim())}
                />
                <p className="text-xs text-muted-foreground">
                  The bookmarklet auto-detects this from your league page URL: .../leagueId/<strong>123456</strong>
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