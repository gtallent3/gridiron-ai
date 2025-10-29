import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ExternalLink, Copy, Check, AlertCircle, Cookie } from "lucide-react";
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
  const { toast } = useToast();

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

  const openEspnLogin = () => {
    window.open('https://www.espn.com/login', '_blank', 'width=800,height=600');
    setStep('extract');
  };

  const copyScript = () => {
    navigator.clipboard.writeText(extractionScript);
    toast({
      title: "Script copied!",
      description: "Paste it in ESPN's browser console (F12)",
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
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
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
                    <p className="text-sm text-muted-foreground">Run a simple script in browser console</p>
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

          {step === 'extract' && (
            <div className="space-y-4">
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  After logging in, open browser DevTools (F12) and go to the Console tab
                </AlertDescription>
              </Alert>

              <div className="space-y-3">
                <Label>Step 1: Copy this script</Label>
                <div className="relative">
                  <pre className="bg-muted p-3 rounded text-xs overflow-x-auto">
                    {extractionScript}
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

                <Label>Step 2: Paste in ESPN console & press Enter</Label>
                <p className="text-sm text-muted-foreground">
                  You'll see an object with 'swid' and 'espn_s2' values
                </p>

                <Label>Step 3: Copy the values below</Label>
              </div>

              <Button onClick={() => setStep('validate')} className="w-full">
                I've got the cookies
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