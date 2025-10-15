import { useState } from "react";
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

// Mock player data - will be replaced with real data from API
const mockStarters = [
  { id: '1', name: 'Patrick Mahomes', position: 'QB', team: 'KC', projected: 24.5, status: 'starter' },
  { id: '2', name: 'Christian McCaffrey', position: 'RB', team: 'SF', projected: 22.8, status: 'starter' },
  { id: '3', name: 'Breece Hall', position: 'RB', team: 'NYJ', projected: 18.3, status: 'starter' },
  { id: '4', name: 'Tyreek Hill', position: 'WR', team: 'MIA', projected: 19.7, status: 'starter' },
  { id: '5', name: 'CeeDee Lamb', position: 'WR', team: 'DAL', projected: 18.9, status: 'starter' },
  { id: '6', name: 'Travis Kelce', position: 'TE', team: 'KC', projected: 14.2, status: 'starter' },
  { id: '7', name: 'Brandon Aubrey', position: 'K', team: 'DAL', projected: 9.5, status: 'starter' },
  { id: '8', name: 'SF Defense', position: 'DEF', team: 'SF', projected: 11.2, status: 'starter' },
];

const mockBench = [
  { id: '9', name: 'Jaylen Waddle', position: 'WR', team: 'MIA', projected: 15.4, status: 'bench' },
  { id: '10', name: 'Drake London', position: 'WR', team: 'ATL', projected: 13.2, status: 'bench' },
  { id: '11', name: 'Najee Harris', position: 'RB', team: 'PIT', projected: 12.8, status: 'bench' },
  { id: '12', name: 'Kyle Pitts', position: 'TE', team: 'ATL', projected: 10.3, status: 'bench' },
];

export function RosterView({ league, userTeam }: RosterViewProps) {
  const [selectedPlayers, setSelectedPlayers] = useState<string[]>([]);
  const [lineup, setLineup] = useState({ starters: mockStarters, bench: mockBench });

  const handlePlayerSelect = (playerId: string) => {
    setSelectedPlayers(prev => 
      prev.includes(playerId) 
        ? prev.filter(id => id !== playerId)
        : [...prev, playerId]
    );
  };

  const handleSubstitution = (starterId: string, benchId: string) => {
    const newStarters = [...lineup.starters];
    const newBench = [...lineup.bench];
    
    const starterIdx = newStarters.findIndex(p => p.id === starterId);
    const benchIdx = newBench.findIndex(p => p.id === benchId);
    
    if (starterIdx !== -1 && benchIdx !== -1) {
      const temp = newStarters[starterIdx];
      newStarters[starterIdx] = { ...newBench[benchIdx], status: 'starter' };
      newBench[benchIdx] = { ...temp, status: 'bench' };
      
      setLineup({ starters: newStarters, bench: newBench });
    }
  };

  const totalProjected = lineup.starters.reduce((sum, p) => sum + p.projected, 0);

  return (
    <div className="space-y-6">
      <StartSitRecommendations 
        starters={lineup.starters}
        bench={lineup.bench}
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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {lineup.starters.map(player => (
              <PlayerCard
                key={player.id}
                player={player}
                isSelected={selectedPlayers.includes(player.id)}
                onSelect={handlePlayerSelect}
              />
            ))}
          </div>
        </CardContent>
      </Card>

      <Separator />

      <Card>
        <CardHeader>
          <CardTitle>Bench</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {lineup.bench.map(player => (
              <PlayerCard
                key={player.id}
                player={player}
                isSelected={selectedPlayers.includes(player.id)}
                onSelect={handlePlayerSelect}
              />
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
