import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Layout } from "./components/Layout";
import { Loader2 } from "lucide-react";

// Eagerly loaded (core user flow)
import Index from "./pages/Index";
import ConnectLeague from "./pages/ConnectLeague";
import Auth from "./pages/Auth";
import LeagueDashboard from "./pages/LeagueDashboard";
import Settings from "./pages/Settings";
import Profile from "./pages/Profile";
import Shop from "./pages/Shop";
import NotFound from "./pages/NotFound";

// Lazy loaded (infrequent routes)
const Admin = lazy(() => import("./pages/Admin"));
const RiskAdmin = lazy(() => import("./pages/RiskAdmin"));
const Billing = lazy(() => import("./pages/Billing"));
const ContactUs = lazy(() => import("./pages/ContactUs"));
const PlayerRankings = lazy(() => import("./pages/PlayerRankings"));
const Props = lazy(() => import("./pages/Props"));
const MyBets = lazy(() => import("./pages/MyBets"));
const Leaderboard = lazy(() => import("./pages/Leaderboard"));
const SeasonRecap = lazy(() => import("./pages/SeasonRecap"));

const queryClient = new QueryClient();

function PageLoader() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Layout>
          <Suspense fallback={<PageLoader />}>
            <Routes>
              <Route path="/" element={<Index />} />
              <Route path="/connect-league" element={<ConnectLeague />} />
              <Route path="/auth" element={<Auth />} />
              <Route path="/league/:leagueId" element={<LeagueDashboard />} />
              <Route path="/league/:leagueId/recap" element={<SeasonRecap />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/shop" element={<Shop />} />
              <Route path="/props" element={<Props />} />
              <Route path="/admin" element={<Admin />} />
              <Route path="/profile" element={<Profile />} />
              <Route path="/my-bets" element={<MyBets />} />
              <Route path="/leaderboard" element={<Leaderboard />} />
              <Route path="/contact" element={<ContactUs />} />
              <Route path="/risk-admin" element={<RiskAdmin />} />
              <Route path="/settings/billing" element={<Billing />} />
              <Route path="/player-rankings" element={<PlayerRankings />} />
              {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </Layout>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
