import { useState } from "react";
import { Menu, X, ChevronDown } from "lucide-react";
import { Button } from "./ui/button";
import { Sheet, SheetContent, SheetTrigger } from "./ui/sheet";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";

type MobileMenuProps = {
  user?: any;
};

export const MobileMenu = ({ user }: MobileMenuProps) => {
  const [open, setOpen] = useState(false);
  const [predictIQOpen, setPredictIQOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);

  const handleNavClick = () => {
    setOpen(false);
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="sm" className="md:hidden touch-target">
          <Menu className="h-5 w-5" />
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-[280px] sm:w-[320px] overflow-y-auto">
        <nav className="flex flex-col space-y-4 mt-8">
          <a 
            href="/" 
            onClick={handleNavClick}
            className="text-base font-medium hover:text-primary transition-colors py-2"
          >
            Dashboard
          </a>

          {/* PredictIQ Collapsible */}
          <Collapsible open={predictIQOpen} onOpenChange={setPredictIQOpen}>
            <CollapsibleTrigger className="flex items-center justify-between w-full text-base font-medium hover:text-primary transition-colors py-2">
              PredictIQ
              <ChevronDown className={`h-4 w-4 transition-transform ${predictIQOpen ? 'rotate-180' : ''}`} />
            </CollapsibleTrigger>
            <CollapsibleContent className="pl-4 space-y-2 mt-2">
              <a 
                href="/props" 
                onClick={handleNavClick}
                className="block text-sm text-muted-foreground hover:text-primary transition-colors py-2"
              >
                PredictIQ
              </a>
              <a 
                href="/my-bets" 
                onClick={handleNavClick}
                className="block text-sm text-muted-foreground hover:text-primary transition-colors py-2"
              >
                My Predictions
              </a>
              <a 
                href="/leaderboard" 
                onClick={handleNavClick}
                className="block text-sm text-muted-foreground hover:text-primary transition-colors py-2"
              >
                Leaderboard
              </a>
            </CollapsibleContent>
          </Collapsible>

          <a 
            href="/shop" 
            onClick={handleNavClick}
            className="text-base font-medium hover:text-primary transition-colors py-2"
          >
            Token Shop
          </a>

          {/* Account Collapsible */}
          <Collapsible open={accountOpen} onOpenChange={setAccountOpen}>
            <CollapsibleTrigger className="flex items-center justify-between w-full text-base font-medium hover:text-primary transition-colors py-2">
              Account
              <ChevronDown className={`h-4 w-4 transition-transform ${accountOpen ? 'rotate-180' : ''}`} />
            </CollapsibleTrigger>
            <CollapsibleContent className="pl-4 space-y-2 mt-2">
              {user && (
                <>
                  <a 
                    href="/profile" 
                    onClick={handleNavClick}
                    className="block text-sm text-muted-foreground hover:text-primary transition-colors py-2"
                  >
                    Profile
                  </a>
                  <a 
                    href="/settings" 
                    onClick={handleNavClick}
                    className="block text-sm text-muted-foreground hover:text-primary transition-colors py-2"
                  >
                    Settings
                  </a>
                </>
              )}
              <a 
                href="/connect-league" 
                onClick={handleNavClick}
                className="block text-sm text-muted-foreground hover:text-primary transition-colors py-2"
              >
                Connect League
              </a>
            </CollapsibleContent>
          </Collapsible>

          <a 
            href="/contact" 
            onClick={handleNavClick}
            className="text-base font-medium hover:text-primary transition-colors py-2"
          >
            Contact Us
          </a>

          {user && (
            <a 
              href="/admin" 
              onClick={handleNavClick}
              className="text-base font-medium hover:text-primary transition-colors py-2"
            >
              Admin
            </a>
          )}
        </nav>
      </SheetContent>
    </Sheet>
  );
};
