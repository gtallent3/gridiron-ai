import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import ConnectLeague from "./pages/ConnectLeague";
import Auth from "./pages/Auth";
import LeagueDashboard from "./pages/LeagueDashboard";
import Settings from "./pages/Settings";
import Admin from "./pages/Admin";
import Shop from "./pages/Shop";
import Props from "./pages/Props";
import Profile from "./pages/Profile";
import MyBets from "./pages/MyBets";
import Leaderboard from "./pages/Leaderboard";
import ContactUs from "./pages/ContactUs";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/connect-league" element={<ConnectLeague />} />
          <Route path="/auth" element={<Auth />} />
          <Route path="/league/:leagueId" element={<LeagueDashboard />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/shop" element={<Shop />} />
          <Route path="/props" element={<Props />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/my-bets" element={<MyBets />} />
          <Route path="/leaderboard" element={<Leaderboard />} />
          <Route path="/contact" element={<ContactUs />} />
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
