import { useNavigate } from "react-router-dom";
import logo from "@/assets/logo.png";

export const Footer = () => {
  const navigate = useNavigate();

  return (
    <footer className="border-t border-border/50 py-12">
      <div className="container mx-auto px-4">
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-8">
            {/* Brand */}
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <img src={logo} alt="Gridiron GM Logo" className="h-8 w-8" />
                <h3 className="text-lg font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                  Gridiron GM
                </h3>
              </div>
              <p className="text-sm text-muted-foreground">
                AI-powered fantasy football insights to help you dominate your league.
              </p>
            </div>

            {/* Product */}
            <div>
              <h4 className="font-semibold mb-4">Product</h4>
              <ul className="space-y-2 text-sm">
                <li>
                  <button 
                    onClick={() => {
                      const element = document.getElementById('features');
                      element?.scrollIntoView({ behavior: 'smooth' });
                    }}
                    className="text-muted-foreground hover:text-primary transition-colors"
                  >
                    Features
                  </button>
                </li>
                <li>
                  <button 
                    onClick={() => navigate('/auth')}
                    className="text-muted-foreground hover:text-primary transition-colors"
                  >
                    Pricing
                  </button>
                </li>
                <li>
                  <button 
                    onClick={() => navigate('/connect-league')}
                    className="text-muted-foreground hover:text-primary transition-colors"
                  >
                    Connect League
                  </button>
                </li>
              </ul>
            </div>

            {/* Company */}
            <div>
              <h4 className="font-semibold mb-4">Company</h4>
              <ul className="space-y-2 text-sm">
                <li>
                  <button 
                    onClick={() => navigate('/contact')}
                    className="text-muted-foreground hover:text-primary transition-colors"
                  >
                    Contact Us
                  </button>
                </li>
                <li>
                  <a 
                    href="/privacy" 
                    className="text-muted-foreground hover:text-primary transition-colors"
                  >
                    Privacy Policy
                  </a>
                </li>
                <li>
                  <a 
                    href="/terms" 
                    className="text-muted-foreground hover:text-primary transition-colors"
                  >
                    Terms of Service
                  </a>
                </li>
              </ul>
            </div>

            {/* Support */}
            <div>
              <h4 className="font-semibold mb-4">Support</h4>
              <ul className="space-y-2 text-sm">
                <li>
                  <button 
                    onClick={() => navigate('/contact')}
                    className="text-muted-foreground hover:text-primary transition-colors"
                  >
                    Help Center
                  </button>
                </li>
                <li>
                  <a 
                    href="mailto:support@gridirong m.com" 
                    className="text-muted-foreground hover:text-primary transition-colors"
                  >
                    Email Support
                  </a>
                </li>
              </ul>
            </div>
          </div>

          {/* Bottom */}
          <div className="pt-8 border-t border-border/30 text-center">
            <p className="text-sm text-muted-foreground">
              © 2025 Gridiron GM. All rights reserved.
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
};
