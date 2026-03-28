import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Loader2, RefreshCw, ArrowUpDown, ArrowUp, ArrowDown, Search } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const RANKINGS_SEASON = new Date().getMonth() >= 8 ? new Date().getFullYear() : new Date().getFullYear() - 1;

interface PlayerRanking {
  id: string;
  player_id: string;
  player_name: string;
  position: string;
  team: string;
  avg_projected_ppg_ros: number;
  avg_actual_ppg: number;
  bye_week: number | null;
  ros_sos_rank: number | null;
  playoff_sos_rank: number | null;
  season: number;
  current_week: number;
  trade_value: number | null;
}

export default function PlayerRankings() {
  const [loading, setLoading] = useState(true);
  const [computing, setComputing] = useState(false);
  const [computingTradeValues, setComputingTradeValues] = useState(false);
  const [rankings, setRankings] = useState<PlayerRanking[]>([]);
  const [selectedPosition, setSelectedPosition] = useState<string>("ALL");
  const [search, setSearch] = useState("");
  const [sortColumn, setSortColumn] = useState<keyof PlayerRanking | null>("avg_projected_ppg_ros");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [isAdmin, setIsAdmin] = useState(false);
  const { toast } = useToast();

  const fetchRankings = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("player_rankings")
        .select("*")
        .eq("season", RANKINGS_SEASON)
        .order("avg_projected_ppg_ros", { ascending: false });

      if (error) throw error;
      setRankings(data || []);
    } catch (error) {
      console.error("Error fetching rankings:", error);
      toast({
        title: "Error",
        description: "Failed to fetch player rankings",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const checkAdmin = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .maybeSingle();
    setIsAdmin(!!data);
  };

  const computeRankings = async () => {
    setComputing(true);
    try {
      const { error } = await supabase.functions.invoke("compute-player-rankings");
      if (error) throw error;
      
      toast({
        title: "Success",
        description: "Player rankings computed successfully",
      });
      
      await fetchRankings();
    } catch (error) {
      console.error("Error computing rankings:", error);
      toast({
        title: "Error",
        description: "Failed to compute player rankings",
        variant: "destructive",
      });
    } finally {
      setComputing(false);
    }
  };

  const computeTradeValues = async () => {
    setComputingTradeValues(true);
    try {
      const { data, error } = await supabase.functions.invoke("compute-trade-value-index");
      if (error) throw error;
      
      toast({
        title: "Success",
        description: data?.message || "Trade values computed successfully",
      });
      
      await fetchRankings();
    } catch (error) {
      console.error("Error computing trade values:", error);
      toast({
        title: "Error",
        description: "Failed to compute trade values",
        variant: "destructive",
      });
    } finally {
      setComputingTradeValues(false);
    }
  };

  useEffect(() => {
    fetchRankings();
    checkAdmin();
  }, []);

  const handleSort = (column: keyof PlayerRanking) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === "desc" ? "asc" : "desc");
    } else {
      setSortColumn(column);
      setSortDirection("desc");
    }
  };

  const getSortIcon = (column: keyof PlayerRanking) => {
    if (sortColumn !== column) {
      return <ArrowUpDown className="ml-2 h-4 w-4 inline opacity-50" />;
    }
    return sortDirection === "desc" ? (
      <ArrowDown className="ml-2 h-4 w-4 inline" />
    ) : (
      <ArrowUp className="ml-2 h-4 w-4 inline" />
    );
  };

  let filteredRankings = rankings
    .filter(r => selectedPosition === "ALL" || r.position === selectedPosition)
    .filter(r => !search || r.player_name.toLowerCase().includes(search.toLowerCase()));

  // Apply sorting
  if (sortColumn) {
    filteredRankings = [...filteredRankings].sort((a, b) => {
      const aVal = a[sortColumn];
      const bVal = b[sortColumn];
      
      // Handle null values - push them to the end
      if (aVal === null && bVal === null) return 0;
      if (aVal === null) return 1;
      if (bVal === null) return -1;
      
      // Compare values
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return sortDirection === "desc" ? bVal - aVal : aVal - bVal;
      }
      
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortDirection === "desc" 
          ? bVal.localeCompare(aVal)
          : aVal.localeCompare(bVal);
      }
      
      return 0;
    });
  }

  const getSosColor = (rank: number | null) => {
    if (!rank) return "default";
    if (rank <= 10) return "destructive"; // Hardest matchups
    if (rank >= 23) return "default"; // Easiest matchups
    return "secondary";
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Player Rankings</h1>
          <p className="text-sm text-muted-foreground mt-1">{RANKINGS_SEASON} Season</p>
        </div>
        {isAdmin && (
          <div className="flex gap-2">
            <Button onClick={computeRankings} disabled={computing} variant="outline" size="sm">
              {computing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Compute Rankings
            </Button>
            <Button onClick={computeTradeValues} disabled={computingTradeValues} variant="outline" size="sm">
              {computingTradeValues ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Compute Trade Values
            </Button>
          </div>
        )}
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search player..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex gap-2">
          {["ALL", "QB", "RB", "WR", "TE"].map((pos) => (
            <Button
              key={pos}
              variant={selectedPosition === pos ? "default" : "outline"}
              size="sm"
              onClick={() => setSelectedPosition(pos)}
            >
              {pos}
            </Button>
          ))}
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Rankings ({filteredRankings.length} players)</CardTitle>
            <p className="text-xs text-muted-foreground">SOS: <span className="text-destructive">low = tough</span> · <span className="text-green-500">high = easy</span></p>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Rank</TableHead>
                    <TableHead 
                      className="cursor-pointer hover:bg-accent/50 transition-colors"
                      onClick={() => handleSort("player_name")}
                    >
                      Player{getSortIcon("player_name")}
                    </TableHead>
                    <TableHead 
                      className="cursor-pointer hover:bg-accent/50 transition-colors"
                      onClick={() => handleSort("position")}
                    >
                      Pos{getSortIcon("position")}
                    </TableHead>
                    <TableHead 
                      className="cursor-pointer hover:bg-accent/50 transition-colors"
                      onClick={() => handleSort("team")}
                    >
                      Team{getSortIcon("team")}
                    </TableHead>
                    <TableHead 
                      className="cursor-pointer hover:bg-accent/50 transition-colors"
                      onClick={() => handleSort("bye_week")}
                    >
                      Bye{getSortIcon("bye_week")}
                    </TableHead>
                    <TableHead 
                      className="text-right cursor-pointer hover:bg-accent/50 transition-colors"
                      onClick={() => handleSort("avg_projected_ppg_ros")}
                    >
                      Proj PPG (ROS){getSortIcon("avg_projected_ppg_ros")}
                    </TableHead>
                    <TableHead 
                      className="text-right cursor-pointer hover:bg-accent/50 transition-colors"
                      onClick={() => handleSort("avg_actual_ppg")}
                    >
                      Actual PPG{getSortIcon("avg_actual_ppg")}
                    </TableHead>
                    <TableHead 
                      className="text-right cursor-pointer hover:bg-accent/50 transition-colors"
                      onClick={() => handleSort("trade_value")}
                    >
                      Trade Value{getSortIcon("trade_value")}
                    </TableHead>
                    <TableHead 
                      className="text-center cursor-pointer hover:bg-accent/50 transition-colors"
                      onClick={() => handleSort("ros_sos_rank")}
                    >
                      ROS SOS{getSortIcon("ros_sos_rank")}
                    </TableHead>
                    <TableHead 
                      className="text-center cursor-pointer hover:bg-accent/50 transition-colors"
                      onClick={() => handleSort("playoff_sos_rank")}
                    >
                      Playoff SOS{getSortIcon("playoff_sos_rank")}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRankings.map((player, index) => (
                    <TableRow key={player.id}>
                      <TableCell className="font-medium">{index + 1}</TableCell>
                      <TableCell>{player.player_name}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{player.position}</Badge>
                      </TableCell>
                      <TableCell>{player.team}</TableCell>
                      <TableCell>{player.bye_week || "-"}</TableCell>
                      <TableCell className="text-right">
                        {player.avg_projected_ppg_ros.toFixed(1)}
                      </TableCell>
                      <TableCell className="text-right">
                        {player.avg_actual_ppg.toFixed(1)}
                      </TableCell>
                      <TableCell className="text-right font-semibold">
                        {player.trade_value ? player.trade_value.toFixed(1) : "-"}
                      </TableCell>
                      <TableCell className="text-center">
                        {player.ros_sos_rank ? (
                          <Badge variant={getSosColor(player.ros_sos_rank)}>
                            {player.ros_sos_rank}
                          </Badge>
                        ) : (
                          "-"
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        {player.playoff_sos_rank ? (
                          <Badge variant={getSosColor(player.playoff_sos_rank)}>
                            {player.playoff_sos_rank}
                          </Badge>
                        ) : (
                          "-"
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
