import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Loader2, RefreshCw, TrendingUp, TrendingDown } from 'lucide-react';
import { toast } from 'sonner';

interface DefensiveRanking {
  team: string;
  position: string;
  avg_points_allowed: number;
  rank: number;
  week: number;
}

interface StrengthOfSchedule {
  id: string;
  season: number;
  team: string;
  position: string;
  ros_sos: number | null;
  playoff_sos: number | null;
  ros_weeks: number[];
  playoff_weeks: number[];
  created_at: string;
  updated_at: string;
}

export default function StrengthOfSchedulePage() {
  const [loading, setLoading] = useState(false);
  const [computing, setComputing] = useState(false);
  const [defensiveRankings, setDefensiveRankings] = useState<DefensiveRanking[]>([]);
  const [sos, setSos] = useState<StrengthOfSchedule[]>([]);
  const [selectedPosition, setSelectedPosition] = useState('QB');
  const [selectedTeam, setSelectedTeam] = useState<string>('');
  const [season] = useState(2025);

  const positions = ['QB', 'RB', 'WR', 'TE'];

  useEffect(() => {
    fetchData();
  }, [selectedPosition]);

  const fetchData = async () => {
    setLoading(true);
    try {
      // Fetch defensive rankings
      const { data: defData, error: defError } = await supabase
        .from('defensive_rankings')
        .select('*')
        .eq('season', season)
        .eq('position', selectedPosition)
        .order('rank', { ascending: true });

      if (defError) throw defError;
      setDefensiveRankings(defData || []);

      // Fetch SOS data (team-level ROS and Playoff SOS)
      const { data: sosData, error: sosError } = await supabase
        .from('strength_of_schedule')
        .select('*')
        .eq('season', season)
        .eq('position', selectedPosition)
        .order('team', { ascending: true });

      if (sosError) throw sosError;
      setSos(sosData || []);
    } catch (error) {
      console.error('Error fetching data:', error);
      toast.error('Failed to load strength of schedule data');
    } finally {
      setLoading(false);
    }
  };

  const computeRankings = async () => {
    setComputing(true);
    try {
      toast.info('Computing defensive rankings...', { duration: 2000 });
      
      const { error } = await supabase.functions.invoke('compute-defensive-rankings', {
        body: { season },
      });

      if (error) throw error;
      
      toast.success('Defensive rankings computed successfully');
      await fetchData();
    } catch (error) {
      console.error('Error computing rankings:', error);
      toast.error('Failed to compute defensive rankings');
    } finally {
      setComputing(false);
    }
  };

  const computeTeamSos = async () => {
    setComputing(true);
    try {
      toast.info('Computing team SOS rankings...', { duration: 2000 });
      
      const { error } = await supabase.functions.invoke('compute-team-sos', {
        body: { season, currentWeek: 10 },
      });

      if (error) throw error;
      
      toast.success('Team SOS rankings computed successfully');
      await fetchData();
    } catch (error) {
      console.error('Error computing team SOS:', error);
      toast.error('Failed to compute team SOS rankings');
    } finally {
      setComputing(false);
    }
  };

  const getSosColor = (sos: number | null) => {
    if (!sos) return 'secondary';
    // Lower SOS = easier schedule (better for offense)
    if (sos <= 10) return 'default'; // Easy matchups
    if (sos <= 20) return 'secondary'; // Medium matchups
    return 'destructive'; // Hard matchups
  };

  const getSosDifficulty = (sos: number | null) => {
    if (!sos) return 'N/A';
    if (sos <= 10) return 'Easy';
    if (sos <= 20) return 'Medium';
    return 'Hard';
  };

  const teams = [...new Set(sos.map(s => s.team))].sort();

  const filteredSos = selectedTeam 
    ? sos.filter(s => s.team === selectedTeam)
    : sos;

  return (
    <div className="container mx-auto p-6 pt-24 space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">Strength of Schedule</h1>
        <div className="flex gap-2">
          <Button onClick={computeRankings} disabled={computing}>
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
          <Button onClick={computeTeamSos} disabled={computing} variant="secondary">
            {computing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Computing...
              </>
            ) : (
              <>
                <TrendingUp className="mr-2 h-4 w-4" />
                Compute Team SOS
              </>
            )}
          </Button>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Defensive Rankings by Position */}
        <Card>
          <CardHeader>
            <CardTitle>Defensive Rankings</CardTitle>
            <div className="flex gap-2 mt-2">
              {positions.map(pos => (
                <Button
                  key={pos}
                  variant={selectedPosition === pos ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setSelectedPosition(pos)}
                >
                  {pos}
                </Button>
              ))}
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex justify-center p-8">
                <Loader2 className="h-8 w-8 animate-spin" />
              </div>
            ) : (
              <div className="max-h-96 overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Rank</TableHead>
                      <TableHead>Team</TableHead>
                      <TableHead>Avg Pts</TableHead>
                      <TableHead>Difficulty</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {defensiveRankings.map((rank) => (
                      <TableRow key={`${rank.team}-${rank.position}`}>
                        <TableCell className="font-medium">{rank.rank}</TableCell>
                        <TableCell>{rank.team}</TableCell>
                        <TableCell>{rank.avg_points_allowed.toFixed(1)}</TableCell>
                        <TableCell>
                          {rank.rank <= 10 ? (
                            <Badge variant="destructive" className="gap-1">
                              <TrendingUp className="h-3 w-3" />
                              Hard
                            </Badge>
                          ) : rank.rank <= 20 ? (
                            <Badge variant="secondary">Medium</Badge>
                          ) : (
                            <Badge variant="default" className="gap-1">
                              <TrendingDown className="h-3 w-3" />
                              Easy
                            </Badge>
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

        {/* Team SOS Ratings */}
        <Card>
          <CardHeader>
            <CardTitle>Team Schedule Strength</CardTitle>
            <select
              className="mt-2 w-full p-2 border rounded"
              value={selectedTeam}
              onChange={(e) => setSelectedTeam(e.target.value)}
            >
              <option value="">All Teams</option>
              {teams.map(team => (
                <option key={team} value={team}>{team}</option>
              ))}
            </select>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex justify-center p-8">
                <Loader2 className="h-8 w-8 animate-spin" />
              </div>
            ) : (
              <div className="max-h-96 overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Team</TableHead>
                      <TableHead>ROS SOS</TableHead>
                      <TableHead>ROS Difficulty</TableHead>
                      <TableHead>Playoff SOS</TableHead>
                      <TableHead>Playoff Difficulty</TableHead>
                      <TableHead>ROS Weeks</TableHead>
                      <TableHead>Playoff Weeks</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredSos.map((teamSos) => (
                      <TableRow key={teamSos.id}>
                        <TableCell className="font-medium">{teamSos.team}</TableCell>
                        <TableCell>
                          <Badge variant={getSosColor(teamSos.ros_sos)}>
                            {teamSos.ros_sos?.toFixed(1) || 'N/A'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {getSosDifficulty(teamSos.ros_sos)}
                        </TableCell>
                        <TableCell>
                          <Badge variant={getSosColor(teamSos.playoff_sos)}>
                            {teamSos.playoff_sos?.toFixed(1) || 'N/A'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {getSosDifficulty(teamSos.playoff_sos)}
                        </TableCell>
                        <TableCell className="text-xs">
                          {teamSos.ros_weeks.join(', ')}
                        </TableCell>
                        <TableCell className="text-xs">
                          {teamSos.playoff_weeks.join(', ')}
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
    </div>
  );
}