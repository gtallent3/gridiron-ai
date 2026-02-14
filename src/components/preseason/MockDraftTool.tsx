import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RotateCcw, Check } from "lucide-react";

interface DraftPlayer {
  name: string;
  position: string;
  team: string;
  rank: number;
}

interface DraftPick {
  round: number;
  pick: number;
  player: DraftPlayer;
  isUser: boolean;
}

export function MockDraftTool() {
  const [leagueSize, setLeagueSize] = useState(12);
  const [userPick, setUserPick] = useState(1);
  const [availablePlayers, setAvailablePlayers] = useState<DraftPlayer[]>([]);
  const [draftPicks, setDraftPicks] = useState<DraftPick[]>([]);
  const [currentPick, setCurrentPick] = useState(1);
  const [currentRound, setCurrentRound] = useState(1);
  const [draftStarted, setDraftStarted] = useState(false);
  const [loading, setLoading] = useState(true);

  const totalRounds = 15;

  useEffect(() => {
    fetchPlayers();
  }, []);

  const fetchPlayers = async () => {
    try {
      const resp = await fetch("https://api.sleeper.app/v1/players/nfl");
      if (!resp.ok) return;
      const data = await resp.json();

      const ranked: DraftPlayer[] = [];
      for (const [, player] of Object.entries(data) as [string, any][]) {
        if (!player.active || !player.position || !player.search_rank) continue;
        if (!["QB", "RB", "WR", "TE", "K", "DEF"].includes(player.position)) continue;

        ranked.push({
          name: player.full_name || `${player.first_name} ${player.last_name}`,
          position: player.position,
          team: player.team || "FA",
          rank: player.search_rank,
        });
      }

      ranked.sort((a, b) => a.rank - b.rank);
      setAvailablePlayers(ranked.slice(0, 250));
    } catch (err) {
      console.error("Failed to load player data:", err);
    } finally {
      setLoading(false);
    }
  };

  const isUserTurn = () => {
    // Snake draft: odd rounds go 1→N, even rounds go N→1
    if (currentRound % 2 === 1) {
      return currentPick === userPick;
    } else {
      return currentPick === leagueSize - userPick + 1;
    }
  };

  const getOverallPick = () => (currentRound - 1) * leagueSize + currentPick;

  const advancePick = () => {
    if (currentPick >= leagueSize) {
      setCurrentRound((r) => r + 1);
      setCurrentPick(1);
    } else {
      setCurrentPick((p) => p + 1);
    }
  };

  const simulateCPUPick = () => {
    if (availablePlayers.length === 0) return;
    // CPU picks the top available player with slight randomness
    const topN = Math.min(3, availablePlayers.length);
    const idx = Math.floor(Math.random() * topN);
    const player = availablePlayers[idx];

    setDraftPicks((prev) => [...prev, {
      round: currentRound,
      pick: getOverallPick(),
      player,
      isUser: false,
    }]);

    setAvailablePlayers((prev) => prev.filter((p) => p.name !== player.name));
    advancePick();
  };

  const handleUserPick = (player: DraftPlayer) => {
    setDraftPicks((prev) => [...prev, {
      round: currentRound,
      pick: getOverallPick(),
      player,
      isUser: true,
    }]);

    setAvailablePlayers((prev) => prev.filter((p) => p.name !== player.name));
    advancePick();
  };

  const startDraft = () => {
    setDraftStarted(true);
    setDraftPicks([]);
    setCurrentPick(1);
    setCurrentRound(1);
  };

  const resetDraft = () => {
    setDraftStarted(false);
    setDraftPicks([]);
    setCurrentPick(1);
    setCurrentRound(1);
    fetchPlayers();
  };

  // Auto-simulate CPU picks
  useEffect(() => {
    if (!draftStarted || currentRound > totalRounds) return;
    if (!isUserTurn() && availablePlayers.length > 0) {
      const timer = setTimeout(simulateCPUPick, 300);
      return () => clearTimeout(timer);
    }
  }, [draftStarted, currentPick, currentRound, availablePlayers]);

  const isDraftComplete = currentRound > totalRounds;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Mock Draft Simulator</CardTitle>
      </CardHeader>
      <CardContent>
        {!draftStarted ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm text-muted-foreground mb-1 block">League Size</label>
                <Select value={String(leagueSize)} onValueChange={(v) => setLeagueSize(Number(v))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="8">8 Teams</SelectItem>
                    <SelectItem value="10">10 Teams</SelectItem>
                    <SelectItem value="12">12 Teams</SelectItem>
                    <SelectItem value="14">14 Teams</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm text-muted-foreground mb-1 block">Your Pick</label>
                <Select value={String(userPick)} onValueChange={(v) => setUserPick(Number(v))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: leagueSize }, (_, i) => (
                      <SelectItem key={i + 1} value={String(i + 1)}>
                        Pick #{i + 1}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Button onClick={startDraft} disabled={loading} className="w-full">
              Start Mock Draft
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="text-sm">
                {isDraftComplete ? (
                  <span className="font-semibold text-primary">Draft Complete!</span>
                ) : (
                  <>Round {currentRound} — Pick {getOverallPick()}{isUserTurn() && <span className="text-primary font-semibold ml-2">Your Pick!</span>}</>
                )}
              </div>
              <Button variant="outline" size="sm" onClick={resetDraft}>
                <RotateCcw className="h-4 w-4 mr-1" />
                Reset
              </Button>
            </div>

            {isUserTurn() && !isDraftComplete && (
              <div className="max-h-[250px] overflow-y-auto border rounded-lg">
                {availablePlayers.slice(0, 20).map((p) => (
                  <button
                    key={p.name}
                    onClick={() => handleUserPick(p)}
                    className="w-full flex items-center justify-between px-3 py-2 hover:bg-secondary/50 border-b border-border/50 text-sm"
                  >
                    <span>
                      <span className="font-medium">{p.name}</span>
                      <span className="text-xs text-muted-foreground ml-2">{p.position} — {p.team}</span>
                    </span>
                    <Check className="h-4 w-4 text-primary opacity-0 group-hover:opacity-100" />
                  </button>
                ))}
              </div>
            )}

            {/* My picks summary */}
            <div>
              <p className="text-xs text-muted-foreground mb-2">Your Picks:</p>
              <div className="space-y-1">
                {draftPicks.filter((p) => p.isUser).map((pick) => (
                  <div key={pick.pick} className="flex items-center gap-2 text-sm px-2 py-1 rounded bg-primary/10">
                    <span className="text-xs text-muted-foreground">R{pick.round}</span>
                    <span className="font-medium">{pick.player.name}</span>
                    <span className="text-xs text-muted-foreground">{pick.player.position}</span>
                  </div>
                ))}
                {draftPicks.filter((p) => p.isUser).length === 0 && (
                  <p className="text-xs text-muted-foreground">No picks yet</p>
                )}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
