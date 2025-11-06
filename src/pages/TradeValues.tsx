import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";

interface TradeValue {
  player_id: string;
  player_name: string;
  position: string;
  team: string;
  trade_value: number;
  raw_value: number;
  meta_proj_ros_ppg: number;
  meta_recent_ppg: number;
  meta_season_ppg: number;
  meta_sos_reg_rank: number;
  meta_sos_po_rank: number;
  meta_bye_adj: number;
  current_week: number;
  snapshot_date: string;
}

export default function TradeValues() {
  const [loading, setLoading] = useState(true);
  const [computing, setComputing] = useState(false);
  const [values, setValues] = useState<TradeValue[]>([]);
  const [selectedPosition, setSelectedPosition] = useState<string>("ALL");
  const { toast } = useToast();

  const fetchValues = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('trade_value_weekly')
        .select('*')
        .not('team', 'is', null)
        .neq('team', '')
        .order('trade_value', { ascending: false });

      if (error) throw error;
      setValues(data || []);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const computeValues = async () => {
    setComputing(true);
    try {
      const { error } = await supabase.functions.invoke('compute-trade-values');
      
      if (error) throw error;
      
      toast({
        title: "Success",
        description: "Trade values computed successfully"
      });
      
      await fetchValues();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive"
      });
    } finally {
      setComputing(false);
    }
  };

  const computeAllData = async () => {
    setComputing(true);
    try {
      toast({
        title: "Starting",
        description: "Step 1/3: Computing team SOS..."
      });

      // Step 1: Compute Team SOS
      const { error: sosError } = await supabase.functions.invoke('compute-team-sos', {
        body: { season: 2025, currentWeek: 1 }
      });
      if (sosError) throw new Error(`SOS computation failed: ${sosError.message}`);

      toast({
        title: "Progress",
        description: "Step 2/3: Fetching projections..."
      });

      // Step 2: Fetch Sleeper Projections (pulls in the SOS data)
      const { error: projError } = await supabase.functions.invoke('fetch-sleeper-projections', {
        body: { season: 2025 }
      });
      if (projError) throw new Error(`Projections fetch failed: ${projError.message}`);

      // Wait for projections to complete
      await new Promise(resolve => setTimeout(resolve, 5000));

      toast({
        title: "Progress",
        description: "Step 3/3: Computing trade values..."
      });

      // Step 3: Compute Trade Values
      const { error: valuesError } = await supabase.functions.invoke('compute-trade-values');
      if (valuesError) throw new Error(`Trade values computation failed: ${valuesError.message}`);

      toast({
        title: "Success",
        description: "All data computed successfully with correct playoff SOS"
      });
      
      await fetchValues();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive"
      });
    } finally {
      setComputing(false);
    }
  };

  useEffect(() => {
    fetchValues();
  }, []);

  const filteredValues = selectedPosition === "ALL" 
    ? values 
    : values.filter(v => v.position === selectedPosition);

  const positions = ["ALL", "QB", "RB", "WR", "TE"];

  return (
    <div className="container mx-auto p-6 pt-24 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Trade Value Index</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Auto-computed daily at 3 AM · Last updated: {values[0]?.snapshot_date || 'Never'}
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={computeAllData} disabled={computing} variant="default">
            {computing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Full Refresh (SOS + Projections + Values)
          </Button>
          <Button onClick={computeValues} disabled={computing} variant="outline">
            {computing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Quick Recompute
          </Button>
        </div>
      </div>

      <div className="flex gap-2">
        {positions.map(pos => (
          <Button
            key={pos}
            variant={selectedPosition === pos ? "default" : "outline"}
            onClick={() => setSelectedPosition(pos)}
            size="sm"
          >
            {pos}
          </Button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center items-center py-12">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      ) : filteredValues.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          No trade values found. Click "Compute Trade Values" to generate them.
        </div>
      ) : (
        <div className="overflow-auto rounded-lg border">
          <table className="min-w-full divide-y">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-semibold">Rank</th>
                <th className="px-4 py-3 text-left text-sm font-semibold">Player</th>
                <th className="px-4 py-3 text-left text-sm font-semibold">Pos</th>
                <th className="px-4 py-3 text-left text-sm font-semibold">Team</th>
                <th className="px-4 py-3 text-right text-sm font-semibold">Trade Value</th>
                <th className="px-4 py-3 text-right text-sm font-semibold">ROS PPG</th>
                <th className="px-4 py-3 text-right text-sm font-semibold">Recent</th>
                <th className="px-4 py-3 text-right text-sm font-semibold">Season</th>
                <th className="px-4 py-3 text-right text-sm font-semibold">SoS Reg</th>
                <th className="px-4 py-3 text-right text-sm font-semibold">SoS PO</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filteredValues.slice(0, 250).map((value, idx) => (
                <tr key={value.player_id} className="hover:bg-muted/30">
                  <td className="px-4 py-3 text-sm">{idx + 1}</td>
                  <td className="px-4 py-3 text-sm font-medium">{value.player_name}</td>
                  <td className="px-4 py-3 text-sm">{value.position}</td>
                  <td className="px-4 py-3 text-sm">{value.team}</td>
                  <td className="px-4 py-3 text-sm text-right font-semibold">{value.trade_value}</td>
                  <td className="px-4 py-3 text-sm text-right">{value.meta_proj_ros_ppg}</td>
                  <td className="px-4 py-3 text-sm text-right">{value.meta_recent_ppg}</td>
                  <td className="px-4 py-3 text-sm text-right">{value.meta_season_ppg}</td>
                  <td className="px-4 py-3 text-sm text-right">{value.meta_sos_reg_rank}</td>
                  <td className="px-4 py-3 text-sm text-right">{value.meta_sos_po_rank}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
