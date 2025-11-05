import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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

interface NFLFantasyPoint {
  id: string;
  player_id: string;
  player_name: string;
  position: string;
  team: string;
  week: number;
  season: number;
  passing_yards: number;
  passing_tds: number;
  passing_ints: number;
  rushing_yards: number;
  rushing_tds: number;
  receiving_yards: number;
  receiving_tds: number;
  receptions: number;
  fantasy_points_std: number;
  fantasy_points_ppr: number;
  fantasy_points_half_ppr: number;
}

export default function NFLFantasyPoints() {
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [records, setRecords] = useState<NFLFantasyPoint[]>([]);
  const [season, setSeason] = useState(2025);
  const [selectedWeek, setSelectedWeek] = useState<number | null>(null);
  const { toast } = useToast();

  const fetchData = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('nfl_fantasy_points')
        .select('*')
        .eq('season', season)
        .order('fantasy_points_ppr', { ascending: false });

      if (selectedWeek) {
        query = query.eq('week', selectedWeek);
      }

      const { data, error } = await query.limit(200);

      if (error) throw error;

      setRecords(data || []);
    } catch (error) {
      console.error('Error fetching fantasy points:', error);
      toast({
        title: "Error",
        description: "Failed to load fantasy points data",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const syncData = async () => {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke('ingest-nfl-fantasy-points', {
        body: { season }
      });

      if (error) throw error;

      toast({
        title: "Success",
        description: data.message || "Fantasy points data synced successfully",
      });

      // Refresh the data
      await fetchData();
    } catch (error) {
      console.error('Error syncing data:', error);
      toast({
        title: "Error",
        description: "Failed to sync fantasy points data",
        variant: "destructive",
      });
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [season, selectedWeek]);

  const weeks = Array.from({ length: 18 }, (_, i) => i + 1);

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">NFL 2025 Fantasy Points</h1>
          <p className="text-muted-foreground mt-2">
            Weekly player stats and fantasy points (Standard & PPR)
          </p>
        </div>
        <Button
          onClick={syncData}
          disabled={syncing}
          variant="outline"
        >
          {syncing ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Syncing...
            </>
          ) : (
            <>
              <RefreshCw className="mr-2 h-4 w-4" />
              Sync Data
            </>
          )}
        </Button>
      </div>

      <Card className="p-4">
        <div className="flex gap-2 flex-wrap">
          <Button
            variant={selectedWeek === null ? "default" : "outline"}
            onClick={() => setSelectedWeek(null)}
            size="sm"
          >
            All Weeks
          </Button>
          {weeks.map((week) => (
            <Button
              key={week}
              variant={selectedWeek === week ? "default" : "outline"}
              onClick={() => setSelectedWeek(week)}
              size="sm"
            >
              Week {week}
            </Button>
          ))}
        </div>
      </Card>

      <Card>
        {loading ? (
          <div className="flex items-center justify-center p-12">
            <Loader2 className="h-8 w-8 animate-spin" />
          </div>
        ) : records.length === 0 ? (
          <div className="text-center p-12">
            <p className="text-muted-foreground">
              No data found. Click "Sync Data" to import NFL stats.
            </p>
          </div>
        ) : (
          <div className="overflow-auto max-h-[70vh]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Player</TableHead>
                  <TableHead className="text-center">Pos</TableHead>
                  <TableHead className="text-center">Team</TableHead>
                  <TableHead className="text-center">Week</TableHead>
                  <TableHead className="text-right">Pass Yds</TableHead>
                  <TableHead className="text-right">Pass TD</TableHead>
                  <TableHead className="text-right">Rush Yds</TableHead>
                  <TableHead className="text-right">Rush TD</TableHead>
                  <TableHead className="text-right">Rec</TableHead>
                  <TableHead className="text-right">Rec Yds</TableHead>
                  <TableHead className="text-right">Rec TD</TableHead>
                  <TableHead className="text-right font-bold">Std</TableHead>
                  <TableHead className="text-right font-bold">PPR</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {records.map((record) => (
                  <TableRow key={record.id}>
                    <TableCell className="font-medium">{record.player_name}</TableCell>
                    <TableCell className="text-center">{record.position}</TableCell>
                    <TableCell className="text-center">{record.team}</TableCell>
                    <TableCell className="text-center">{record.week}</TableCell>
                    <TableCell className="text-right">{record.passing_yards || '-'}</TableCell>
                    <TableCell className="text-right">{record.passing_tds || '-'}</TableCell>
                    <TableCell className="text-right">{record.rushing_yards || '-'}</TableCell>
                    <TableCell className="text-right">{record.rushing_tds || '-'}</TableCell>
                    <TableCell className="text-right">{record.receptions || '-'}</TableCell>
                    <TableCell className="text-right">{record.receiving_yards || '-'}</TableCell>
                    <TableCell className="text-right">{record.receiving_tds || '-'}</TableCell>
                    <TableCell className="text-right font-bold">
                      {record.fantasy_points_std.toFixed(1)}
                    </TableCell>
                    <TableCell className="text-right font-bold">
                      {record.fantasy_points_ppr.toFixed(1)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>

      <div className="text-sm text-muted-foreground">
        Showing {records.length} players • Data from nflfastR
      </div>
    </div>
  );
}
