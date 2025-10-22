import { Zap, LogOut, LogIn } from "lucide-react";
import { Button } from "./ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import logo from "@/assets/logo.png";
import { TokenBalance } from "./TokenBalance";

type HeaderProps = {
  user?: any;
};

export const Header = ({ user }: HeaderProps) => {
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await supabase.auth.signOut();
  };
  return <header className="fixed top-0 left-0 right-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-lg">
      <div className="container mx-auto px-4">
        <div className="flex h-16 items-center justify-between">
          <div className="flex items-center gap-3">
            <img src={logo} alt="Gridiron GM Logo" className="h-10 w-10" />
            <h1 className="text-xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">Gridiron GM</h1>
          </div>
          
          <nav className="hidden md:flex items-center gap-6">
            <a href="/" className="text-sm text-muted-foreground hover:text-primary transition-colors">
              Dashboard
            </a>
            <a href="/props" className="text-sm text-muted-foreground hover:text-primary transition-colors">
              Props Betting
            </a>
            <a href="/my-bets" className="text-sm text-muted-foreground hover:text-primary transition-colors">
              My Bets
            </a>
            <a href="/leaderboard" className="text-sm text-muted-foreground hover:text-primary transition-colors">
              Leaderboard
            </a>
            <a href="/shop" className="text-sm text-muted-foreground hover:text-primary transition-colors">
              Token Shop
            </a>
            <a href="/connect-league" className="text-sm text-muted-foreground hover:text-primary transition-colors">
              Connect League
            </a>
            {user && (
              <>
                <a href="/profile" className="text-sm text-muted-foreground hover:text-primary transition-colors">
                  Profile
                </a>
                <a href="/settings" className="text-sm text-muted-foreground hover:text-primary transition-colors">
                  Settings
                </a>
                <a href="/admin" className="text-sm text-muted-foreground hover:text-primary transition-colors">
                  Admin
                </a>
              </>
            )}
          </nav>

          {user ? (
            <div className="flex items-center gap-3">
              <TokenBalance />
              <Button variant="outline" size="sm" onClick={handleSignOut}>
                <LogOut className="h-4 w-4 mr-2" />
                Sign Out
              </Button>
            </div>
          ) : (
            <Button variant="hero" size="sm" onClick={() => navigate('/auth')}>
              <LogIn className="h-4 w-4 mr-2" />
              Sign In
            </Button>
          )}
        </div>
      </div>
    </header>;
};