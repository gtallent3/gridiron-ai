import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Search, ShoppingBag } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { TradeProposalCard } from "./TradeProposalCard";

type League = {
  id: string;
  platform: string;
  scoring_type: string;
};

type Team = {
  team_id: string;
  team_name: string;
  roster: any[];
};

type TradeFinderProps = {
  league: League;
  userTeam: Team;
  allTeams: Team[];
};

export function TradeFinder({ league, userTeam, allTeams }: TradeFinderProps) {
  const { toast } = useToast();
  const [mode, setMode] = useState<'target' | 'shop'>('target');
  const [selectedPlayerId, setSelectedPlayerId] = useState<string>("");
  const [proposals, setProposals] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const POSITION_MAP: Record<number, string> = {
    1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 16: 'DEF',
  };

  const normalizePlayer = (player: any) => {
    const playerId = player.player_id || player.playerId || player.id;
    const playerName = player.player_name || player.playerName || player.name || 'Unknown';
    let positionName = POSITION_MAP[player.position] || player.position || 'FLEX';
    if (typeof positionName === 'number') {
      positionName = POSITION_MAP[positionName] || 'FLEX';
    }
    return {
      id: playerId,
      canonical_player_id: player.canonical_player_id, // Preserve for player_rankings lookup
      name: playerName,
      position: positionName.toString().toUpperCase(),
      team: player.team || 'NFL',
      projected: player.projected || 0,
    };
  };

  const allPlayers = mode === 'target'
    ? allTeams.flatMap(t => (t.roster || []).map(p => ({ ...normalizePlayer(p), ownerTeamId: t.team_id })))
        .filter(p => p.id !== userTeam.roster.find(r => normalizePlayer(r).id === p.id)?.id)
    : (userTeam.roster || []).map(normalizePlayer);

  const handleFindTrades = async () => {
    if (!selectedPlayerId) {
      toast({
        title: "Selection Required",
        description: `Please select a player to ${mode === 'target' ? 'target' : 'shop'}`,
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    setProposals([]);

    try {
      // Verify session before making the call
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        throw new Error('Please log in to use this feature');
      }

      const { data, error } = await supabase.functions.invoke('find-trades', {
        body: {
          mode,
          leagueId: league.id,
          myTeam: {
            team_id: userTeam.team_id,
            roster: (userTeam.roster || []).map(normalizePlayer),
          },
          allTeams: allTeams.map(t => ({
            team_id: t.team_id,
            team_name: t.team_name,
            roster: (t.roster || []).map(normalizePlayer),
          })),
          targetPlayerId: mode === 'target' ? selectedPlayerId : undefined,
          shopPlayerId: mode === 'shop' ? selectedPlayerId : undefined,
        }
      });

      if (error) throw error;

      setProposals(data.proposals || []);
      
      toast({
        title: "Trade Finder Complete",
        description: `Found ${data.proposals?.length || 0} potential trade packages`,
      });
    } catch (error: any) {
      console.error('Error finding trades:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to find trades",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Trade Finder</CardTitle>
          <p className="text-sm text-muted-foreground">
            Find fair trade packages to acquire or trade away specific players
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Button
              variant={mode === 'target' ? 'default' : 'outline'}
              onClick={() => { setMode('target'); setSelectedPlayerId(""); setProposals([]); }}
              className="flex-1"
            >
              <Search className="mr-2 h-4 w-4" />
              Target Player
            </Button>
            <Button
              variant={mode === 'shop' ? 'default' : 'outline'}
              onClick={() => { setMode('shop'); setSelectedPlayerId(""); setProposals([]); }}
              className="flex-1"
            >
              <ShoppingBag className="mr-2 h-4 w-4" />
              Shop My Player
            </Button>
          </div>

          <div className="flex gap-2">
            <Select value={selectedPlayerId} onValueChange={setSelectedPlayerId}>
              <SelectTrigger className="flex-1">
                <SelectValue placeholder={mode === 'target' ? "Select player to acquire" : "Select player to trade"} />
              </SelectTrigger>
              <SelectContent>
                {allPlayers.map(player => (
                  <SelectItem key={player.id} value={player.id}>
                    {player.name} ({player.position}) - {player.team}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button onClick={handleFindTrades} disabled={loading || !selectedPlayerId}>
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Finding...
                </>
              ) : (
                "Find Trades"
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {proposals.length > 0 && (
        <div className="space-y-4">
          <h3 className="font-semibold">Trade Proposals ({proposals.length})</h3>
          {proposals.map((proposal, idx) => (
            <TradeProposalCard key={idx} proposal={proposal} league={league} userTeam={userTeam} />
          ))}
        </div>
      )}

      {!loading && proposals.length === 0 && selectedPlayerId && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No fair trade packages found. Try adjusting your filters or selecting a different player.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
