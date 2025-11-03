import { Zap, LogOut, LogIn, ChevronDown } from "lucide-react";
import { Button } from "./ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import logo from "@/assets/logo.png";
import { TokenBalance } from "./TokenBalance";
import { MobileMenu } from "./MobileMenu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type HeaderProps = {
  user?: any;
};

export const Header = ({ user }: HeaderProps) => {
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await supabase.auth.signOut();
  };
  return <header className="fixed top-0 left-0 right-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-lg">
      <div className="container mx-auto px-4 sm:px-6">
        <div className="flex h-16 items-center justify-between">
          <div className="flex items-center gap-2 sm:gap-3">
            <img src={logo} alt="Gridiron GM Logo" className="h-8 w-8 sm:h-10 sm:w-10 opacity-80 mix-blend-lighten" />
            <h1 className="text-base sm:text-xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">Gridiron GM</h1>
          </div>
          
          <nav className="hidden md:flex items-center gap-6">
            <a href="/" className="flex items-center h-9 text-sm text-muted-foreground hover:text-primary transition-colors">
              Dashboard
            </a>
            
            {/* Betting Dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger className="flex items-center gap-1 h-9 text-sm text-muted-foreground hover:text-primary transition-colors outline-none">
                Betting <ChevronDown className="h-3 w-3" />
              </DropdownMenuTrigger>
              <DropdownMenuContent className="bg-card border-border z-50">
                <DropdownMenuItem asChild>
                  <a href="/props" className="cursor-pointer">Props Betting</a>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <a href="/my-bets" className="cursor-pointer">My Bets</a>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <a href="/leaderboard" className="cursor-pointer">Leaderboard</a>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <a href="/shop" className="flex items-center h-9 text-sm text-muted-foreground hover:text-primary transition-colors">
              Token Shop
            </a>

            {/* Account Dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger className="flex items-center gap-1 h-9 text-sm text-muted-foreground hover:text-primary transition-colors outline-none">
                Account <ChevronDown className="h-3 w-3" />
              </DropdownMenuTrigger>
              <DropdownMenuContent className="bg-card border-border z-50">
                {user && (
                  <>
                    <DropdownMenuItem asChild>
                      <a href="/profile" className="cursor-pointer">Profile</a>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <a href="/settings" className="cursor-pointer">Settings</a>
                    </DropdownMenuItem>
                  </>
                )}
                <DropdownMenuItem asChild>
                  <a href="/connect-league" className="cursor-pointer">Connect League</a>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <a href="/contact" className="flex items-center h-9 text-sm text-muted-foreground hover:text-primary transition-colors">
              Contact Us
            </a>

            {user && (
              <a href="/admin" className="flex items-center h-9 text-sm text-muted-foreground hover:text-primary transition-colors">
                Admin
              </a>
            )}
          </nav>

          <div className="flex items-center gap-2 sm:gap-3">
            {/* Mobile Menu */}
            <MobileMenu user={user} />

            {/* Desktop Actions */}
            {user ? (
              <div className="hidden md:flex items-center gap-3">
                <TokenBalance />
                <Button variant="outline" size="sm" onClick={handleSignOut}>
                  <LogOut className="h-4 w-4 mr-2" />
                  <span className="hidden lg:inline">Sign Out</span>
                  <span className="lg:hidden">Out</span>
                </Button>
              </div>
            ) : (
              <Button variant="hero" size="sm" onClick={() => navigate('/auth')} className="hidden md:flex">
                <LogIn className="h-4 w-4 mr-2" />
                Sign In
              </Button>
            )}

            {/* Mobile Token Balance & Auth */}
            <div className="flex md:hidden items-center gap-2">
              {user ? (
                <>
                  <TokenBalance />
                  <Button variant="ghost" size="sm" onClick={handleSignOut} className="touch-target">
                    <LogOut className="h-4 w-4" />
                  </Button>
                </>
              ) : (
                <Button variant="hero" size="sm" onClick={() => navigate('/auth')} className="touch-target">
                  <LogIn className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </header>;
};