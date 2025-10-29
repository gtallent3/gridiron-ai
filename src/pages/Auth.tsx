import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Loader2, AlertTriangle } from "lucide-react";
import { z } from "zod";
import { generateDeviceFingerprint } from "@/lib/deviceFingerprint";

const authSchema = z.object({
  email: z.string().trim().email("Please enter a valid email address").max(255, "Email is too long"),
  password: z.string().min(6, "Password must be at least 6 characters").max(72, "Password is too long"),
  username: z.string()
    .trim()
    .min(3, "Username must be at least 3 characters")
    .max(20, "Username must be less than 20 characters")
    .regex(/^[a-zA-Z0-9_]+$/, "Username can only contain letters, numbers, and underscores")
    .optional(),
});

export default function Auth() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);
  const [riskWarning, setRiskWarning] = useState<string | null>(null);
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    // Check if user is already logged in
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        navigate('/');
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (session) {
        navigate('/');
      }
    });

    return () => subscription.unsubscribe();
  }, [navigate]);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      // Validate inputs with zod schema
      const validationResult = authSchema.safeParse({ 
        email, 
        password, 
        username: isSignUp ? username : undefined 
      });
      
      if (!validationResult.success) {
        const firstError = validationResult.error.errors[0];
        toast({
          title: "Validation Error",
          description: firstError.message,
          variant: "destructive",
        });
        setIsLoading(false);
        return;
      }

      const { email: validEmail, password: validPassword, username: validUsername } = validationResult.data;

      if (isSignUp) {
        // Generate device fingerprint
        const fingerprint = await generateDeviceFingerprint();
        
        // Call server-side signup handler that captures real IP
        const { data: signupResult, error: signupError } = await supabase.functions.invoke('handle-signup', {
          body: {
            email: validEmail,
            password: validPassword,
            username: validUsername,
            fingerprint,
          },
        });

        if (signupError) {
          setRiskWarning('Unable to create account. Please try again later.');
          setIsLoading(false);
          return;
        }

        if (signupResult?.blocked) {
          setRiskWarning(signupResult.message || 'Account creation blocked for security reasons.');
          setIsLoading(false);
          return;
        }

        if (signupResult?.requires_verification) {
          setRiskWarning(signupResult.message || 'Additional verification required.');
          setIsLoading(false);
          return;
        }

        if (signupResult?.error === 'username_taken') {
          toast({
            title: "Username Taken",
            description: signupResult.message,
            variant: "destructive",
          });
          setIsLoading(false);
          return;
        }

        if (!signupResult?.success) {
          throw new Error(signupResult?.error || 'Signup failed');
        }

        toast({
          title: "Account created!",
          description: "You can now sign in.",
        });
        setIsSignUp(false);
        setUsername("");
        setRiskWarning(null);
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: validEmail,
          password: validPassword,
        });

        if (error) throw error;

        toast({
          title: "Welcome back!",
          description: "You've successfully signed in.",
        });
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Authentication failed. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-background to-secondary/20 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{isSignUp ? "Create Account" : "Sign In"}</CardTitle>
          <CardDescription>
            {isSignUp
              ? "Create an account to sync your fantasy leagues"
              : "Sign in to access your fantasy leagues"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {riskWarning && (
            <div className="mb-4 p-3 bg-destructive/10 border border-destructive/30 rounded-md flex gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive flex-shrink-0 mt-0.5" />
              <div className="text-sm text-destructive">{riskWarning}</div>
            </div>
          )}
          <form onSubmit={handleAuth} className="space-y-4">
            {isSignUp && (
              <div className="space-y-2">
                <Label htmlFor="username">Username</Label>
                <Input
                  id="username"
                  type="text"
                  placeholder="Choose a unique username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  minLength={3}
                  maxLength={20}
                  pattern="[a-zA-Z0-9_]+"
                />
                <p className="text-xs text-muted-foreground">
                  3-20 characters, letters, numbers, and underscores only
                </p>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="Enter your email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
              />
            </div>
            <Button type="submit" className="w-full" disabled={isLoading} variant="glow">
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {isSignUp ? "Creating account..." : "Signing in..."}
                </>
              ) : (
                <>{isSignUp ? "Create Account" : "Sign In"}</>
              )}
            </Button>
          </form>
          <div className="mt-4 text-center">
            <button
              type="button"
              onClick={() => setIsSignUp(!isSignUp)}
              className="text-sm text-muted-foreground hover:text-primary"
            >
              {isSignUp
                ? "Already have an account? Sign in"
                : "Don't have an account? Sign up"}
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}