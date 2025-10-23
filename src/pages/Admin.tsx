import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Loader2, Users, Trophy, DollarSign, BarChart3, Settings, Download, Coins } from "lucide-react";
import { Header } from "@/components/Header";
import { useTokens } from "@/hooks/useTokens";
import { useNavigate } from "react-router-dom";

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
  const [selectedUserId, setSelectedUserId] = useState("");
  const [tokenAmount, setTokenAmount] = useState(1);
  const [adjusting, setAdjusting] = useState(false);

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
    fetchProps();
    fetchTransactions();
    fetchAnalytics();
  };

  // USER MANAGEMENT
  const fetchUsers = async () => {
    const { data, error } = await supabase
      .from("user_tokens")
      .select(`
        user_id, 
        balance, 
        has_unlimited_subscription,
        profiles(username)
      `)
      .limit(100);

    if (error) {
      console.error("Error fetching users:", error);
      return;
    }

    const usersData = (data || []).map(tokenData => ({
      id: tokenData.user_id,
      username: (tokenData.profiles as any)?.username || `user_${tokenData.user_id.substring(0, 8)}`,
      balance: tokenData.balance,
      has_unlimited_subscription: tokenData.has_unlimited_subscription,
    }));

    setUsers(usersData);
  };

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
      const { error } = await supabase.from("weekly_props").insert([{
        ...newProp,
        player_id: `${newProp.player_name.toLowerCase().replace(/\s+/g, '_')}_${Date.now()}`,
        status: "pending"
      }]);

      if (error) throw error;

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
    <div className="min-h-screen bg-background">
      <Header user={user} />
      
      <main className="container mx-auto px-4 pt-24 pb-12">
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold">Admin Dashboard</h1>
              <p className="text-muted-foreground">Manage users, props, and view analytics</p>
            </div>
            <Badge variant="default" className="flex items-center gap-2">
              <Settings className="h-4 w-4" />
              Admin Access
            </Badge>
          </div>

          {/* Analytics Overview */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
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
          <Tabs defaultValue="users" className="space-y-6">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="users">User Management</TabsTrigger>
              <TabsTrigger value="props">Props Management</TabsTrigger>
              <TabsTrigger value="transactions">Transactions</TabsTrigger>
            </TabsList>

            {/* User Management Tab */}
            <TabsContent value="users" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Adjust User Tokens</CardTitle>
                  <CardDescription>Manually adjust token balances for users</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a user" />
                    </SelectTrigger>
                    <SelectContent>
                      {users.map(user => (
                        <SelectItem key={user.id} value={user.id}>
                          {user.username} - {user.balance} tokens
                          {user.has_unlimited_subscription && " (Subscriber)"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Input
                    type="number"
                    placeholder="Token amount"
                    value={tokenAmount}
                    onChange={(e) => setTokenAmount(parseInt(e.target.value) || 0)}
                  />

                  <div className="flex gap-2">
                    <Button onClick={() => handleTokenAdjustment("add")} disabled={adjusting}>
                      Add Tokens
                    </Button>
                    <Button onClick={() => handleTokenAdjustment("subtract")} variant="destructive" disabled={adjusting}>
                      Remove Tokens
                    </Button>
                    <Button onClick={() => handleTokenAdjustment("set")} variant="outline" disabled={adjusting}>
                      Set Balance
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Grant Subscriber Status</CardTitle>
                  <CardDescription>Give users unlimited access with 10 bonus tokens</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a user" />
                    </SelectTrigger>
                    <SelectContent>
                      {users.map(user => (
                        <SelectItem key={user.id} value={user.id}>
                          {user.username} - {user.has_unlimited_subscription ? "Subscriber" : "Basic"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Button onClick={() => handleGrantSubscription(1)} disabled={adjusting}>
                    Grant 1 Month
                  </Button>
                  <Button onClick={() => handleGrantSubscription(3)} disabled={adjusting}>
                    Grant 3 Months
                  </Button>
                  <Button onClick={() => handleGrantSubscription(12)} disabled={adjusting}>
                    Grant 1 Year
                  </Button>
                  <Button 
                    onClick={handleRemoveSubscription} 
                    disabled={adjusting}
                    variant="destructive"
                  >
                    Remove Subscription
                  </Button>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>All Users</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {users.map(user => (
                      <div key={user.id} className="flex items-center justify-between p-3 border rounded-lg">
                        <div>
                          <div className="font-medium">{user.username}</div>
                          <div className="text-sm text-muted-foreground">{user.id}</div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant={user.has_unlimited_subscription ? "default" : "outline"}>
                            {user.balance} tokens
                          </Badge>
                          {user.has_unlimited_subscription && (
                            <Badge>Unlimited</Badge>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Props Management Tab */}
            <TabsContent value="props" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Create New Prop</CardTitle>
                  <CardDescription>Add a new weekly prop for betting</CardDescription>
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

            {/* Transactions Tab */}
            <TabsContent value="transactions" className="space-y-4">
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle>Transaction Log</CardTitle>
                      <CardDescription>View all token transactions</CardDescription>
                    </div>
                    <div className="flex gap-2">
                      <Select value={transactionFilter} onValueChange={setTransactionFilter}>
                        <SelectTrigger className="w-[180px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Transactions</SelectItem>
                          <SelectItem value="purchase">Purchases</SelectItem>
                          <SelectItem value="ai_assistant">AI Assistant</SelectItem>
                          <SelectItem value="start_sit">Start/Sit</SelectItem>
                          <SelectItem value="trade_analysis">Trade Analysis</SelectItem>
                          <SelectItem value="prop_bet">Props Betting</SelectItem>
                          <SelectItem value="weekly_reward">Weekly Rewards</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button onClick={exportTransactions} variant="outline">
                        <Download className="mr-2 h-4 w-4" />
                        Export CSV
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {transactions.map(transaction => (
                      <div key={transaction.id} className="flex items-center justify-between p-3 border rounded-lg">
                        <div className="flex-1">
                          <div className="font-medium">{transaction.description}</div>
                          <div className="text-xs text-muted-foreground">
                            {new Date(transaction.created_at).toLocaleString()}
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          <Badge variant="outline">{transaction.transaction_type}</Badge>
                          <div className={`font-semibold ${transaction.amount > 0 ? "text-green-500" : "text-red-500"}`}>
                            {transaction.amount > 0 ? "+" : ""}{transaction.amount}
                          </div>
                          <div className="text-sm text-muted-foreground min-w-[80px] text-right">
                            Balance: {transaction.balance_after}
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
    </div>
  );
}
