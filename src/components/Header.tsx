import { Zap } from "lucide-react";
import { Button } from "./ui/button";
import logo from "@/assets/logo.png";

export const Header = () => {
  return (
    <header className="fixed top-0 left-0 right-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-lg">
      <div className="container mx-auto px-4">
        <div className="flex h-16 items-center justify-between">
          <div className="flex items-center gap-3">
            <img src={logo} alt="Fantasy AI Logo" className="h-8 w-8" />
            <h1 className="text-xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
              Fantasy AI
            </h1>
          </div>
          
          <nav className="hidden md:flex items-center gap-6">
            <a href="#dashboard" className="text-sm text-muted-foreground hover:text-primary transition-colors">
              Dashboard
            </a>
            <a href="#start-sit" className="text-sm text-muted-foreground hover:text-primary transition-colors">
              Start/Sit
            </a>
            <a href="#compare" className="text-sm text-muted-foreground hover:text-primary transition-colors">
              Compare
            </a>
            <a href="#assistant" className="text-sm text-muted-foreground hover:text-primary transition-colors">
              AI Assistant
            </a>
          </nav>

          <Button variant="hero" size="sm">
            <Zap className="h-4 w-4" />
            Get Started
          </Button>
        </div>
      </div>
    </header>
  );
};
