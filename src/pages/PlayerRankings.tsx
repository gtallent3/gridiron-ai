import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

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
  const { toast } = useToast();

  const fetchRankings = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("player_rankings")
        .select("*")
        .eq("season", 2025)
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
  }, []);

  const filteredRankings = selectedPosition === "ALL" 
    ? rankings 
    : rankings.filter(r => r.position === selectedPosition);

  const getSosColor = (rank: number | null) => {
    if (!rank) return "default";
    if (rank <= 10) return "destructive"; // Hardest matchups
    if (rank >= 23) return "default"; // Easiest matchups
    return "secondary";
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">Player Rankings</h1>
        <div className="flex gap-2">
          <Button onClick={computeRankings} disabled={computing} variant="outline">
            {computing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Computing...
              </>
            ) : (
              <>
                <RefreshCw className="mr-2 h-4 w-4" />
                Compute Rankings
              </>
            )}
          </Button>
          <Button onClick={computeTradeValues} disabled={computingTradeValues}>
            {computingTradeValues ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Computing...
              </>
            ) : (
              <>
                <RefreshCw className="mr-2 h-4 w-4" />
                Compute Trade Values
              </>
            )}
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filter by Position</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            {["ALL", "QB", "RB", "WR", "TE"].map((pos) => (
              <Button
                key={pos}
                variant={selectedPosition === pos ? "default" : "outline"}
                onClick={() => setSelectedPosition(pos)}
              >
                {pos}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Rankings ({filteredRankings.length} players)</CardTitle>
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
                    <TableHead>Player</TableHead>
                    <TableHead>Pos</TableHead>
                    <TableHead>Team</TableHead>
                    <TableHead>Bye</TableHead>
                    <TableHead className="text-right">Proj PPG (ROS)</TableHead>
                    <TableHead className="text-right">Actual PPG</TableHead>
                    <TableHead className="text-right">Trade Value</TableHead>
                    <TableHead className="text-center">ROS SOS</TableHead>
                    <TableHead className="text-center">Playoff SOS</TableHead>
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
