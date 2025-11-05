import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Loader2, Users, Trophy, DollarSign, BarChart3, Settings, Download, Coins, Search } from "lucide-react";

import { useTokens } from "@/hooks/useTokens";
import { useNavigate } from "react-router-dom";
import { RankingsAccessManager } from "@/components/admin/RankingsAccessManager";

type UserWithTokens = {
  id: string;
  username: string;
  balance: number;
  has_unlimited_subscription: boolean;
};

type Prop = {
  id: string;
  player_name: string;
  team: string;
  stat_type: string;
  line: number;
  over_multiplier: number;
  under_multiplier: number;
  status: string;
  week: number;
  season: number;
  actual_value: number | null;
};

type Transaction = {
  id: string;
  user_id: string;
  transaction_type: string;
  amount: number;
  balance_after: number;
  description: string;
  created_at: string;
};

export default function Admin() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const { refreshBalance } = useTokens();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  // User Management State
  const [users, setUsers] = useState<UserWithTokens[]>([]);
  const [filteredUsers, setFilteredUsers] = useState<UserWithTokens[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedUserId, setSelectedUserId] = useState("");
  const [tokenAmount, setTokenAmount] = useState(1);
  const [adjusting, setAdjusting] = useState(false);
  const [userRoles, setUserRoles] = useState<Map<string, boolean>>(new Map());

  // Props Management State
  const [props, setProps] = useState<Prop[]>([]);
  const [newProp, setNewProp] = useState<{
    player_name: string;
    team: string;
    stat_type: "fantasy_points" | "passing_yards" | "receiving_yards" | "receptions" | "rushing_yards" | "touchdowns";
    line: number;
    over_multiplier: number;
    under_multiplier: number;
    week: number;
    season: number;
  }>({
    player_name: "",
    team: "",
    stat_type: "passing_yards",
    line: 0,
    over_multiplier: 2.0,
    under_multiplier: 2.0,
    week: 1,
    season: 2025,
  });
  const [creatingProp, setCreatingProp] = useState(false);

  // Transactions State
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [transactionFilter, setTransactionFilter] = useState<string>("all");

  // Analytics State
  const [analytics, setAnalytics] = useState({
    totalUsers: 0,
    activeProps: 0,
    totalTokensCirculation: 0,
    weeklyRevenue: 0,
  });

  // Scraper State
  const [scraperRunning, setScraperRunning] = useState(false);
  const [scraperResult, setScraperResult] = useState<any>(null);
  
  // Sleeper Projections State
  const [sleeperFetching, setSleeperFetching] = useState(false);
  const [sleeperResult, setSleeperResult] = useState<any>(null);
  
  // Sleeper Players State
  const [playersIngesting, setPlayersIngesting] = useState(false);
  const [playersResult, setPlayersResult] = useState<any>(null);

  // NFL Fantasy Points State
  const [nflFetching, setNflFetching] = useState(false);
  const [nflResult, setNflResult] = useState<any>(null);

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      navigate("/auth");
      return;
    }

    setUser(user);

    // Check if user has admin role
    const { data: roleData } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .single();

    if (!roleData) {
      toast({
        title: "Access Denied",
        description: "You don't have admin permissions",
        variant: "destructive",
      });
      navigate("/");
      return;
    }

    setIsAdmin(true);
    setLoading(false);
    
    // Load all data
    fetchUsers();
    fetchUserRoles();
    fetchProps();
    fetchTransactions();
    fetchAnalytics();
  };

  // USER MANAGEMENT
  const fetchUsers = async () => {
    // 1) Get token rows (no join)
    const { data: tokenRows, error: tokensError } = await supabase
      .from("user_tokens")
      .select("user_id, balance, has_unlimited_subscription")
      .limit(100);

    if (tokensError) {
      console.error("Error fetching users:", tokensError);
      return;
    }

    const ids = (tokenRows || []).map((r) => r.user_id);

    // 2) Fetch profiles for those ids (may be empty for legacy users)
    let profileMap = new Map<string, string>();
    if (ids.length > 0) {
      const { data: profiles, error: profilesError } = await supabase
        .from("profiles")
        .select("id, username")
        .in("id", ids);

      if (profilesError) {
        console.error("Error fetching profiles:", profilesError);
      } else if (profiles) {
        profiles.forEach((p: any) => profileMap.set(p.id, p.username));
      }
    }

    const usersData = (tokenRows || []).map((row: any) => ({
      id: row.user_id,
      username: profileMap.get(row.user_id) || `user_${row.user_id.substring(0, 8)}`,
      balance: row.balance,
      has_unlimited_subscription: row.has_unlimited_subscription,
    }));

    setUsers(usersData);
    setFilteredUsers(usersData);
  };

  const fetchUserRoles = async () => {
    const { data, error } = await supabase
      .from("user_roles")
      .select("user_id, role")
      .eq("role", "admin");

    if (error) {
      console.error("Error fetching roles:", error);
      return;
    }

    const roleMap = new Map<string, boolean>();
    (data || []).forEach((role: any) => {
      roleMap.set(role.user_id, true);
    });
    setUserRoles(roleMap);
  };

  // Filter users based on search query
  useEffect(() => {
    if (!searchQuery.trim()) {
      setFilteredUsers(users);
    } else {
      const query = searchQuery.toLowerCase();
      const filtered = users.filter(user => 
        user.username.toLowerCase().includes(query) ||
        user.id.toLowerCase().includes(query)
      );
      setFilteredUsers(filtered);
    }
  }, [searchQuery, users]);
  const handleTokenAdjustment = async (action: "add" | "subtract" | "set") => {
    if (!selectedUserId) {
      toast({
        title: "Select User",
        description: "Please select a user first",
        variant: "destructive",
      });
      return;
    }

    setAdjusting(true);
    try {
      const { error } = await supabase.functions.invoke("admin-adjust-tokens", {
        body: { 
          userId: selectedUserId,
          action, 
          amount: tokenAmount 
        },
      });

      if (error) throw error;

      toast({
        title: "Success",
        description: `Tokens ${action === "add" ? "added" : action === "subtract" ? "removed" : "set"} successfully`,
      });

      fetchUsers();
      fetchUserRoles();
      refreshBalance();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to adjust tokens",
        variant: "destructive",
      });
    } finally {
      setAdjusting(false);
    }
  };

  const handleGrantSubscription = async (months: number) => {
    if (!selectedUserId) {
      toast({
        title: "Select User",
        description: "Please select a user first",
        variant: "destructive",
      });
      return;
    }

    setAdjusting(true);
    try {
      const { data, error } = await supabase.functions.invoke("admin-grant-subscription", {
        body: { 
          userId: selectedUserId,
          durationMonths: months 
        },
      });

      if (error) throw error;

      toast({
        title: "Subscription Granted",
        description: `User now has subscriber status for ${months} month${months > 1 ? 's' : ''} with 10 bonus tokens`,
      });

      fetchUsers();
      fetchUserRoles();
      refreshBalance();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to grant subscription",
        variant: "destructive",
      });
    } finally {
      setAdjusting(false);
    }
  };

  const handleRemoveSubscription = async () => {
    if (!selectedUserId) {
      toast({
        title: "Select User",
        description: "Please select a user first",
        variant: "destructive",
      });
      return;
    }

    setAdjusting(true);
    try {
      const { error } = await supabase.functions.invoke("admin-remove-subscription", {
        body: { userId: selectedUserId },
      });

      if (error) throw error;

      toast({
        title: "Subscription Removed",
        description: "User subscription status has been removed",
      });

      fetchUsers();
      fetchUserRoles();
      refreshBalance();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to remove subscription",
        variant: "destructive",
      });
    } finally {
      setAdjusting(false);
    }
  };

  const handleManageRole = async (targetUserId: string, action: "grant" | "revoke") => {
    setAdjusting(true);
    try {
      const { error } = await supabase.functions.invoke("admin-manage-role", {
        body: { targetUserId, action },
      });

      if (error) throw error;

      toast({
        title: action === "grant" ? "Admin Granted" : "Admin Revoked",
        description: `Successfully ${action === "grant" ? "granted" : "revoked"} admin privileges`,
      });

      fetchUserRoles();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to manage role",
        variant: "destructive",
      });
    } finally {
      setAdjusting(false);
    }
  };

  // PROPS MANAGEMENT
  const fetchProps = async () => {
    const { data, error } = await supabase
      .from("weekly_props")
      .select("*")
      .order("week", { ascending: false })
      .limit(50);

    if (error) {
      console.error("Error fetching props:", error);
      return;
    }

    setProps(data || []);
  };

  const handleCreateProp = async () => {
    if (!newProp.player_name || !newProp.team || newProp.line === 0) {
      toast({
        title: "Missing Fields",
        description: "Please fill in all required fields",
        variant: "destructive",
      });
      return;
    }

    setCreatingProp(true);
    try {
      const { data, error } = await supabase.functions.invoke('admin-create-prop', {
        body: newProp
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      toast({
        title: "Prop Created",
        description: `Created prop for ${newProp.player_name}`,
      });

      setNewProp({
        player_name: "",
        team: "",
        stat_type: "passing_yards",
        line: 0,
        over_multiplier: 2.0,
        under_multiplier: 2.0,
        week: 1,
        season: 2025,
      });

      fetchProps();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to create prop",
        variant: "destructive",
      });
    } finally {
      setCreatingProp(false);
    }
  };

  const handleSettleProp = async (propId: string, actualValue: number) => {
    try {
      // Call secure backend function that enforces admin and bypasses RLS via SECURITY DEFINER
      const { error } = await supabase.rpc('settle_weekly_prop', {
        p_prop_id: propId,
        p_actual_value: actualValue,
      });

      if (error) throw error;

      toast({
        title: "Prop Settled",
        description: `Prop settled` ,
      });

      fetchProps();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to settle prop",
        variant: "destructive",
      });
    }
  };

  // TRANSACTIONS
  const fetchTransactions = async () => {
    let query = supabase
      .from("token_transactions")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);

    if (transactionFilter !== "all") {
      query = query.eq("transaction_type", transactionFilter as any);
    }

    const { data, error } = await query;

    if (error) {
      console.error("Error fetching transactions:", error);
      return;
    }

    setTransactions(data || []);
  };

  useEffect(() => {
    if (isAdmin) {
      fetchTransactions();
    }
  }, [transactionFilter, isAdmin]);

  // ANALYTICS
  const fetchAnalytics = async () => {
    // Total users
    const { count: userCount } = await supabase
      .from("user_tokens")
      .select("*", { count: "exact", head: true });

    // Active props
    const { count: propsCount } = await supabase
      .from("weekly_props")
      .select("*", { count: "exact", head: true })
      .in("status", ["pending", "active"]);

    // Total tokens in circulation
    const { data: tokensData } = await supabase
      .from("user_tokens")
      .select("balance");
    
    const totalTokens = tokensData?.reduce((sum, user) => sum + user.balance, 0) || 0;

    setAnalytics({
      totalUsers: userCount || 0,
      activeProps: propsCount || 0,
      totalTokensCirculation: totalTokens,
      weeklyRevenue: 0,
    });
  };

  const exportTransactions = () => {
    const csv = [
      ["Date", "User ID", "Type", "Amount", "Balance After", "Description"].join(","),
      ...transactions.map(t => 
        [
          new Date(t.created_at).toLocaleString(),
          t.user_id,
          t.transaction_type,
          t.amount,
          t.balance_after,
          `"${t.description}"`
        ].join(",")
      )
    ].join("\n");

    const blob = new Blob([csv], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `transactions-${new Date().toISOString()}.csv`;
    a.click();
  };

  // SCRAPER
  const handleRunScraper = async () => {
    setScraperRunning(true);
    setScraperResult(null);
    
    try {
      const { data, error } = await supabase.functions.invoke('ingest-fantasycalc', {
        body: {}
      });

      if (error) throw error;

      setScraperResult(data);
      toast({
        title: "Scraper Complete",
        description: `Found ${data.rows_found} players, inserted ${data.rows_inserted}`,
      });
    } catch (error: any) {
      toast({
        title: "Scraper Error",
        description: error.message || "Failed to run scraper",
        variant: "destructive",
      });
      setScraperResult({ error: error.message });
    } finally {
      setScraperRunning(false);
    }
  };

  // SLEEPER PLAYERS
  const handleIngestSleeperPlayers = async () => {
    setPlayersIngesting(true);
    setPlayersResult(null);
    
    try {
      const { data, error } = await supabase.functions.invoke('ingest-sleeper-players', {
        body: {}
      });

      if (error) throw error;

      setPlayersResult(data);
      toast({
        title: "Player Ingestion Started",
        description: data.message || "Check logs for progress",
      });
    } catch (error: any) {
      toast({
        title: "Ingestion Error",
        description: error.message || "Failed to ingest players",
        variant: "destructive",
      });
      setPlayersResult({ error: error.message });
    } finally {
      setPlayersIngesting(false);
    }
  };

  // SLEEPER PROJECTIONS
  const handleFetchSleeperProjections = async () => {
    setSleeperFetching(true);
    setSleeperResult(null);
    
    try {
      const { data, error } = await supabase.functions.invoke('fetch-sleeper-projections', {
        body: {}
      });

      if (error) throw error;

      setSleeperResult(data);
      toast({
        title: "Projections Fetched",
        description: data.message || "Check logs for progress",
      });
    } catch (error: any) {
      toast({
        title: "Fetch Error",
        description: error.message || "Failed to fetch projections",
        variant: "destructive",
      });
      setSleeperResult({ error: error.message });
    } finally {
      setSleeperFetching(false);
    }
  };

  // NFL FANTASY POINTS
  const handleFetchNFLFantasyPoints = async () => {
    setNflFetching(true);
    setNflResult(null);
    
    try {
      const { data, error } = await supabase.functions.invoke('ingest-nfl-fantasy-points', {
        body: { season: 2025 }
      });

      if (error) throw error;

      setNflResult(data);
      toast({
        title: "NFL Data Fetched",
        description: data.message || `Processed ${data.records_processed || 0} records`,
      });
    } catch (error: any) {
      toast({
        title: "Fetch Error",
        description: error.message || "Failed to fetch NFL data",
        variant: "destructive",
      });
      setNflResult({ error: error.message });
    } finally {
      setNflFetching(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAdmin) {
    return null;
  }

  return (
    <main className="container mx-auto px-4 sm:px-6 pt-20 sm:pt-24 pb-8 sm:pb-12">
        <div className="spacing-mobile">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold">Admin Dashboard</h1>
              <p className="text-sm sm:text-base text-muted-foreground">Manage users, props, and view analytics</p>
            </div>
            <Badge variant="default" className="flex items-center gap-2">
              <Settings className="h-4 w-4" />
              Admin Access
            </Badge>
          </div>

          {/* Analytics Overview */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Users className="h-4 w-4 text-primary" />
                  Total Users
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{analytics.totalUsers}</div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Trophy className="h-4 w-4 text-primary" />
                  Active Props
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{analytics.activeProps}</div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Coins className="h-4 w-4 text-primary" />
                  Tokens in Circulation
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{analytics.totalTokensCirculation.toLocaleString()}</div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-primary" />
                  Weekly Revenue
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">${analytics.weeklyRevenue}</div>
              </CardContent>
            </Card>
          </div>

          {/* Main Admin Tabs */}
          <Tabs defaultValue="users" className="spacing-mobile">
            <TabsList className="grid w-full grid-cols-2 sm:grid-cols-4 h-auto">
              <TabsTrigger value="users" className="text-sm py-2 sm:py-3">User Management</TabsTrigger>
              <TabsTrigger value="props" className="text-sm py-2 sm:py-3">Props Management</TabsTrigger>
              <TabsTrigger value="transactions" className="text-sm py-2 sm:py-3">Transactions</TabsTrigger>
              <TabsTrigger value="scraper" className="text-sm py-2 sm:py-3">Data Scraper</TabsTrigger>
            </TabsList>

            {/* User Management Tab */}
            <TabsContent value="users" className="spacing-mobile">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg sm:text-xl">Adjust User Tokens</CardTitle>
                  <CardDescription className="text-sm">Manually adjust token balances for users</CardDescription>
                </CardHeader>
                <CardContent className="spacing-mobile">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Search Users</label>
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        placeholder="Search by username or ID..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-9"
                      />
                    </div>
                  </div>

                  <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                    <SelectTrigger className="touch-target">
                      <SelectValue placeholder="Select a user" />
                    </SelectTrigger>
                    <SelectContent>
                      {filteredUsers.map(user => (
                        <SelectItem key={user.id} value={user.id}>
                          {user.username} - {user.balance} tokens
                          {user.has_unlimited_subscription && " (Subscriber)"}
                          {userRoles.get(user.id) && " [Admin]"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Input
                    type="number"
                    placeholder="Token amount"
                    value={tokenAmount}
                    onChange={(e) => setTokenAmount(parseInt(e.target.value) || 0)}
                    className="touch-target"
                  />

                  <div className="flex flex-col sm:flex-row gap-2">
                    <Button onClick={() => handleTokenAdjustment("add")} disabled={adjusting} className="w-full sm:w-auto touch-target">
                      Add Tokens
                    </Button>
                    <Button onClick={() => handleTokenAdjustment("subtract")} variant="destructive" disabled={adjusting} className="w-full sm:w-auto touch-target">
                      Remove Tokens
                    </Button>
                    <Button onClick={() => handleTokenAdjustment("set")} variant="outline" disabled={adjusting} className="w-full sm:w-auto touch-target">
                      Set Balance
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-lg sm:text-xl">Grant Subscriber Status</CardTitle>
                  <CardDescription className="text-sm">Give users unlimited access with 10 bonus tokens</CardDescription>
                </CardHeader>
                <CardContent className="spacing-mobile">
                  <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                    <SelectTrigger className="touch-target">
                      <SelectValue placeholder="Select a user" />
                    </SelectTrigger>
                    <SelectContent>
                      {filteredUsers.map(user => (
                        <SelectItem key={user.id} value={user.id}>
                          {user.username} - {user.has_unlimited_subscription ? "Subscriber" : "Basic"}
                          {userRoles.get(user.id) && " [Admin]"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <Button onClick={() => handleGrantSubscription(1)} disabled={adjusting} className="touch-target">
                      Grant 1 Month
                    </Button>
                    <Button onClick={() => handleGrantSubscription(3)} disabled={adjusting} className="touch-target">
                      Grant 3 Months
                    </Button>
                    <Button onClick={() => handleGrantSubscription(12)} disabled={adjusting} className="touch-target">
                      Grant 1 Year
                    </Button>
                    <Button 
                      onClick={handleRemoveSubscription} 
                      disabled={adjusting}
                      variant="destructive"
                      className="touch-target"
                    >
                      Remove Subscription
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <RankingsAccessManager 
                selectedUserId={selectedUserId}
                onSuccess={() => {
                  fetchUsers();
                  toast({
                    title: "Success",
                    description: "Rankings access updated successfully",
                  });
                }}
              />

              <Card>
                <CardHeader>
                  <div className="flex flex-col gap-4">
                    <CardTitle className="text-lg sm:text-xl">All Users</CardTitle>
                    <div className="w-full">
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          placeholder="Search by username or ID..."
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          className="pl-9 touch-target"
                        />
                      </div>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {filteredUsers.length === 0 ? (
                      <p className="text-center text-muted-foreground py-8 text-sm">
                        No users found
                      </p>
                    ) : (
                      filteredUsers.map(rowUser => (
                        <div key={rowUser.id} className="flex flex-col sm:flex-row gap-3 p-3 sm:p-4 border rounded-lg">
                          <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-2 mb-1">
                              <div className="font-medium break-words">{rowUser.username}</div>
                              {userRoles.get(rowUser.id) && (
                                <Badge variant="destructive" className="text-xs">Admin</Badge>
                              )}
                            </div>
                            <div className="text-xs sm:text-sm text-muted-foreground truncate">{rowUser.id}</div>
                          </div>
                          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-3">
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge variant={rowUser.has_unlimited_subscription ? "default" : "outline"} className="text-xs">
                                {rowUser.balance} tokens
                              </Badge>
                              {rowUser.has_unlimited_subscription && (
                                <Badge className="text-xs">Unlimited</Badge>
                              )}
                            </div>
                            {rowUser.id !== user?.id && (
                              userRoles.get(rowUser.id) ? (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleManageRole(rowUser.id, "revoke")}
                                  disabled={adjusting}
                                  className="w-full sm:w-auto touch-target text-xs"
                                >
                                  Revoke Admin
                                </Button>
                              ) : (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleManageRole(rowUser.id, "grant")}
                                  disabled={adjusting}
                                  className="w-full sm:w-auto touch-target text-xs"
                                >
                                  Make Admin
                                </Button>
                              )
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Props Management Tab */}
            <TabsContent value="props" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Create New Prop</CardTitle>
                  <CardDescription>Add a new weekly prop for PredictIQ</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <Input
                      placeholder="Player Name"
                      value={newProp.player_name}
                      onChange={(e) => setNewProp({ ...newProp, player_name: e.target.value })}
                    />
                    <Input
                      placeholder="Team"
                      value={newProp.team}
                      onChange={(e) => setNewProp({ ...newProp, team: e.target.value })}
                    />
                    <Select
                      value={newProp.stat_type}
                      onValueChange={(value) => setNewProp({ ...newProp, stat_type: value as typeof newProp.stat_type })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="passing_yards">Passing Yards</SelectItem>
                        <SelectItem value="rushing_yards">Rushing Yards</SelectItem>
                        <SelectItem value="receiving_yards">Receiving Yards</SelectItem>
                        <SelectItem value="touchdowns">Touchdowns</SelectItem>
                        <SelectItem value="receptions">Receptions</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input
                      type="number"
                      placeholder="Line"
                      value={newProp.line || ""}
                      onChange={(e) => setNewProp({ ...newProp, line: parseFloat(e.target.value) || 0 })}
                    />
                    <Input
                      type="number"
                      placeholder="Week"
                      value={newProp.week}
                      onChange={(e) => setNewProp({ ...newProp, week: parseInt(e.target.value) || 1 })}
                    />
                    <Input
                      type="number"
                      placeholder="Over Multiplier"
                      step="0.1"
                      value={newProp.over_multiplier}
                      onChange={(e) => setNewProp({ ...newProp, over_multiplier: parseFloat(e.target.value) || 2.0 })}
                    />
                    <Input
                      type="number"
                      placeholder="Under Multiplier"
                      step="0.1"
                      value={newProp.under_multiplier}
                      onChange={(e) => setNewProp({ ...newProp, under_multiplier: parseFloat(e.target.value) || 2.0 })}
                    />
                  </div>
                  <Button onClick={handleCreateProp} disabled={creatingProp}>
                    {creatingProp && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Create Prop
                  </Button>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Active Props</CardTitle>
                  <CardDescription>Manage and settle weekly props</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {props.map(prop => (
                      <div key={prop.id} className="border rounded-lg p-4 space-y-2">
                        <div className="flex items-start justify-between">
                          <div>
                            <div className="font-semibold">{prop.player_name} - {prop.team}</div>
                            <div className="text-sm text-muted-foreground">
                              {prop.stat_type.replace(/_/g, " ")} - Line: {prop.line}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              Week {prop.week}, {prop.season} | Over: {prop.over_multiplier}x | Under: {prop.under_multiplier}x
                            </div>
                          </div>
                          <Badge variant={
                            prop.status === "pending" ? "outline" : 
                            prop.status === "won" ? "default" : 
                            "destructive"
                          }>
                            {prop.status}
                          </Badge>
                        </div>
                        {prop.status === "pending" && (
                          <div className="flex gap-2 items-center">
                            <Input
                              type="number"
                              placeholder="Actual value"
                              className="max-w-[150px]"
                              id={`actual-${prop.id}`}
                            />
                            <Button
                              size="sm"
                              onClick={() => {
                                const input = document.getElementById(`actual-${prop.id}`) as HTMLInputElement;
                                const actualValue = parseFloat(input.value);
                                if (!isNaN(actualValue)) {
                                  handleSettleProp(prop.id, actualValue);
                                }
                              }}
                            >
                              Settle
                            </Button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Data Scraper Tab */}
            <TabsContent value="scraper" className="spacing-mobile">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg sm:text-xl">FantasyCalc Scraper</CardTitle>
                  <CardDescription className="text-sm">Test the trade values data scraper</CardDescription>
                </CardHeader>
                <CardContent className="spacing-mobile">
                  <div className="space-y-4">
                    <div className="p-4 bg-muted rounded-lg">
                      <p className="text-sm mb-2">
                        This scraper fetches player rankings from FantasyCalc and stores them in the <code className="text-xs bg-background px-1 py-0.5 rounded">trade_values</code> table.
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Scheduled to run daily at 7:10 AM ET. Use the button below to test it manually.
                      </p>
                    </div>

                    <Button 
                      onClick={handleRunScraper} 
                      disabled={scraperRunning}
                      className="w-full sm:w-auto"
                    >
                      {scraperRunning && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      {scraperRunning ? "Running Scraper..." : "Run Scraper Now"}
                    </Button>

                    {scraperResult && (
                      <div className="p-4 border rounded-lg">
                        <div className="font-semibold mb-2">Last Run Results:</div>
                        <div className="space-y-1 text-sm">
                          {scraperResult.error ? (
                            <div className="text-destructive">Error: {scraperResult.error}</div>
                          ) : (
                            <>
                              <div>Players Found: <span className="font-medium">{scraperResult.rows_found}</span></div>
                              <div>Inserted: <span className="font-medium text-green-600">{scraperResult.rows_inserted}</span></div>
                              <div>Skipped: <span className="font-medium text-yellow-600">{scraperResult.rows_skipped || 0}</span></div>
                              <div>Errors: <span className="font-medium text-red-600">{scraperResult.errors || 0}</span></div>
                              <div className="text-xs text-muted-foreground mt-2">
                                Snapshot Date: {scraperResult.snapshot_date}
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-lg sm:text-xl">Sleeper Player Database</CardTitle>
                  <CardDescription className="text-sm">Ingest all NFL players from Sleeper API (one-time setup)</CardDescription>
                </CardHeader>
                <CardContent className="spacing-mobile">
                  <div className="space-y-4">
                    <div className="p-4 bg-muted rounded-lg">
                      <p className="text-sm mb-2">
                        This fetches ~8,000+ NFL players from Sleeper API and populates the <code className="text-xs bg-background px-1 py-0.5 rounded">normalized_players</code> table with player names, positions, and IDs.
                      </p>
                      <p className="text-xs text-muted-foreground">
                        <strong>Important:</strong> Run this BEFORE fetching projections so player names can be matched to projection data.
                      </p>
                    </div>

                    <Button 
                      onClick={handleIngestSleeperPlayers} 
                      disabled={playersIngesting}
                      className="w-full sm:w-auto"
                      variant="secondary"
                    >
                      {playersIngesting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      {playersIngesting ? "Ingesting Players..." : "Ingest Sleeper Players"}
                    </Button>

                    {playersResult && (
                      <div className="p-4 border rounded-lg">
                        <div className="font-semibold mb-2">Last Ingestion Results:</div>
                        <div className="space-y-1 text-sm">
                          {playersResult.error ? (
                            <div className="text-destructive">Error: {playersResult.error}</div>
                          ) : (
                            <div className="text-xs text-muted-foreground">
                              {playersResult.message}
                              <br />
                              Check Cloud logs for detailed progress.
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-lg sm:text-xl">Sleeper NFL Projections</CardTitle>
                  <CardDescription className="text-sm">Fetch 2025 season projections from Sleeper API</CardDescription>
                </CardHeader>
                <CardContent className="spacing-mobile">
                  <div className="space-y-4">
                    <div className="p-4 bg-muted rounded-lg">
                      <p className="text-sm mb-2">
                        This fetches all player projections for weeks 1-18 of the 2025 NFL season from the Sleeper API and stores them in the <code className="text-xs bg-background px-1 py-0.5 rounded">sleeper_projections</code> table.
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Player names will be automatically populated if you've run the player ingestion above.
                      </p>
                    </div>

                    <Button 
                      onClick={handleFetchSleeperProjections} 
                      disabled={sleeperFetching}
                      className="w-full sm:w-auto"
                    >
                      {sleeperFetching && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      {sleeperFetching ? "Fetching Projections..." : "Fetch Sleeper Projections"}
                    </Button>

                    {sleeperResult && (
                      <div className="p-4 border rounded-lg">
                        <div className="font-semibold mb-2">Last Fetch Results:</div>
                        <div className="space-y-1 text-sm">
                          {sleeperResult.error ? (
                            <div className="text-destructive">Error: {sleeperResult.error}</div>
                          ) : (
                            <div className="text-xs text-muted-foreground">
                              {sleeperResult.message}
                              <br />
                              Check Cloud logs for detailed progress.
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-lg sm:text-xl">NFL Fantasy Points (nflfastR)</CardTitle>
                  <CardDescription className="text-sm">Fetch actual NFL player stats and fantasy points</CardDescription>
                </CardHeader>
                <CardContent className="spacing-mobile">
                  <div className="space-y-4">
                    <div className="p-4 bg-muted rounded-lg">
                      <p className="text-sm mb-2">
                        This fetches actual weekly player stats from nflfastR for the 2025 season and calculates fantasy points (Standard, PPR, Half-PPR) based on real game data.
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Data includes passing, rushing, receiving stats and is stored in the <code className="text-xs bg-background px-1 py-0.5 rounded">nfl_fantasy_points</code> table.
                      </p>
                    </div>

                    <Button 
                      onClick={handleFetchNFLFantasyPoints} 
                      disabled={nflFetching}
                      className="w-full sm:w-auto"
                    >
                      {nflFetching && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      {nflFetching ? "Fetching NFL Data..." : "Fetch NFL Fantasy Points"}
                    </Button>

                    {nflResult && (
                      <div className="p-4 border rounded-lg">
                        <div className="font-semibold mb-2">Last Fetch Results:</div>
                        <div className="space-y-1 text-sm">
                          {nflResult.error ? (
                            <div className="text-destructive">Error: {nflResult.error}</div>
                          ) : (
                            <div className="text-xs text-muted-foreground">
                              {nflResult.message}
                              {nflResult.records_processed && (
                                <>
                                  <br />
                                  Records processed: {nflResult.records_processed}
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Transactions Tab */}
            <TabsContent value="transactions" className="spacing-mobile">
              <Card>
                <CardHeader>
                  <div className="space-y-4 sm:space-y-0 sm:flex sm:items-center sm:justify-between">
                    <div>
                      <CardTitle className="text-lg sm:text-xl">Transaction Log</CardTitle>
                      <CardDescription className="text-sm">View all token transactions</CardDescription>
                    </div>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <Select value={transactionFilter} onValueChange={setTransactionFilter}>
                        <SelectTrigger className="w-full sm:w-[180px] touch-target">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Transactions</SelectItem>
                          <SelectItem value="purchase">Purchases</SelectItem>
                          <SelectItem value="ai_assistant">AI Assistant</SelectItem>
                          <SelectItem value="start_sit">Start/Sit</SelectItem>
                          <SelectItem value="trade_analysis">Trade Analysis</SelectItem>
                          <SelectItem value="prop_bet">PredictIQ</SelectItem>
                          <SelectItem value="weekly_reward">Weekly Rewards</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button onClick={exportTransactions} variant="outline" className="touch-target">
                        <Download className="mr-2 h-4 w-4" />
                        <span className="hidden sm:inline">Export CSV</span>
                        <span className="sm:hidden">Export</span>
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {transactions.map(transaction => (
                      <div key={transaction.id} className="flex flex-col sm:flex-row sm:items-center justify-between p-3 border rounded-lg gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm sm:text-base break-words">{transaction.description}</div>
                          <div className="text-xs text-muted-foreground break-words">
                            {new Date(transaction.created_at).toLocaleString()}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 sm:gap-4 justify-between sm:justify-end shrink-0 flex-wrap">
                          <Badge variant="outline" className="text-xs">{transaction.transaction_type}</Badge>
                          <div className={`font-semibold text-sm sm:text-base ${transaction.amount > 0 ? "text-green-500" : "text-red-500"}`}>
                            {transaction.amount > 0 ? "+" : ""}{transaction.amount}
                          </div>
                          <div className="text-xs sm:text-sm text-muted-foreground text-right whitespace-nowrap">
                            Bal: {transaction.balance_after}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </main>
  );
}
