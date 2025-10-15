import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PlayerCard } from "./PlayerCard";
import { StartSitRecommendations } from "./StartSitRecommendations";
import { Separator } from "@/components/ui/separator";

type League = {
  id: string;
  platform: string;
};

type Team = {
  roster: any;
} | null;

type RosterViewProps = {
  league: League;
  userTeam: Team;
};

// Position mapping for ESPN
const POSITION_MAP: Record<number, string> = {
  1: 'QB',
  2: 'RB',
  3: 'WR',
  4: 'TE',
  5: 'K',
  16: 'DEF',
};

// Slot types for starters vs bench
const STARTER_SLOTS = [0, 2, 4, 6, 16, 17, 23];
const BENCH_SLOT = 20;

export function RosterView({ league, userTeam }: RosterViewProps) {
  const [selectedPlayers, setSelectedPlayers] = useState<string[]>([]);
  const [starters, setStarters] = useState<any[]>([]);
  const [bench, setBench] = useState<any[]>([]);

  useEffect(() => {
    if (userTeam?.roster && Array.isArray(userTeam.roster)) {
      const starterPlayers: any[] = [];
      const benchPlayers: any[] = [];

      userTeam.roster.forEach((player: any) => {
        const positionName = POSITION_MAP[player.position] || 'FLEX';
        const playerData = {
          id: player.player_id,
          name: player.player_name,
          position: positionName,
          team: 'NFL', // Team info not in current data
          projected: Math.random() * 20 + 5, // Mock projection for now
          status: STARTER_SLOTS.includes(player.slot) ? 'starter' : 'bench',
        };

        if (STARTER_SLOTS.includes(player.slot)) {
          starterPlayers.push(playerData);
        } else if (player.slot === BENCH_SLOT) {
          benchPlayers.push(playerData);
        }
      });

      setStarters(starterPlayers);
      setBench(benchPlayers);
    }
  }, [userTeam]);

  const handlePlayerSelect = (playerId: string) => {
    setSelectedPlayers(prev => 
      prev.includes(playerId) 
        ? prev.filter(id => id !== playerId)
        : [...prev, playerId]
    );
  };

  const handleSubstitution = (starterId: string, benchId: string) => {
    const newStarters = [...starters];
    const newBench = [...bench];
    
    const starterIdx = newStarters.findIndex(p => p.id === starterId);
    const benchIdx = newBench.findIndex(p => p.id === benchId);
    
    if (starterIdx !== -1 && benchIdx !== -1) {
      const temp = newStarters[starterIdx];
      newStarters[starterIdx] = { ...newBench[benchIdx], status: 'starter' };
      newBench[benchIdx] = { ...temp, status: 'bench' };
      
      setStarters(newStarters);
      setBench(newBench);
    }
  };

  const totalProjected = starters.reduce((sum, p) => sum + p.projected, 0);

  if (!userTeam) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          <p>No team data available for this league.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <StartSitRecommendations 
        starters={starters}
        bench={bench}
        onSubstitution={handleSubstitution}
      />

      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <CardTitle>Starting Lineup</CardTitle>
            <div className="text-right">
              <p className="text-sm text-muted-foreground">Total Projected</p>
              <p className="text-2xl font-bold text-primary">{totalProjected.toFixed(1)}</p>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {starters.length === 0 ? (
            <p className="text-center py-8 text-muted-foreground">No starters found</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {starters.map(player => (
                <PlayerCard
                  key={player.id}
                  player={player}
                  isSelected={selectedPlayers.includes(player.id)}
                  onSelect={handlePlayerSelect}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Separator />

      <Card>
        <CardHeader>
          <CardTitle>Bench</CardTitle>
        </CardHeader>
        <CardContent>
          {bench.length === 0 ? (
            <p className="text-center py-8 text-muted-foreground">No bench players found</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {bench.map(player => (
                <PlayerCard
                  key={player.id}
                  player={player}
                  isSelected={selectedPlayers.includes(player.id)}
                  onSelect={handlePlayerSelect}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
