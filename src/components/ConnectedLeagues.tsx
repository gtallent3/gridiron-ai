import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { CheckCircle2, GripVertical, Loader2, Plus, RefreshCw, Trash2, Trophy } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useSeasonState } from "@/hooks/useSeasonState";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

type League = {
  id: string;
  platform: string;
  league_name: string;
  league_size: number;
  scoring_type: string;
  scoring_settings?: any;
  last_synced_at: string;
  display_order: number;
};

interface SortableLeagueItemProps {
  league: League;
  refreshingId: string | null;
  deletingId: string | null;
  isOffseason: boolean;
  onResync: (e: React.MouseEvent, leagueId: string, platform: string) => void;
  onDelete: (league: League) => void;
  onNavigate: (id: string) => void;
  onRecap: (id: string) => void;
  getDisplayScoringType: (lg: any) => string;
}

const SortableLeagueItem = ({
  league,
  refreshingId,
  deletingId,
  isOffseason,
  onResync,
  onDelete,
  onNavigate,
  onRecap,
  getDisplayScoringType,
}: SortableLeagueItemProps) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: league.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:gap-4 p-4 rounded-lg border-2 border-primary/40 hover:border-primary/60 transition-colors bg-background"
    >
      <div
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing touch-none p-1 -ml-1 text-muted-foreground hover:text-foreground"
        onClick={(e) => e.stopPropagation()}
      >
        <GripVertical className="h-5 w-5" />
      </div>
      <div
        className="space-y-1 flex-1 min-w-0 cursor-pointer"
        onClick={() => onNavigate(league.id)}
      >
        <div className="flex items-center gap-2 flex-wrap">
          <h4 className="font-semibold break-words">{league.league_name}</h4>
          <Badge variant="outline" className="shrink-0">{league.platform.toUpperCase()}</Badge>
          <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
        </div>
        <p className="text-sm text-muted-foreground break-words">
          {league.league_size} teams • {getDisplayScoringType(league).replace("_", " ").toUpperCase()}
        </p>
        <p className="text-xs text-muted-foreground break-words">
          Last synced: {new Date(league.last_synced_at).toLocaleString()}
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
        {isOffseason && (
          <Button
            variant="outline"
            size="sm"
            onClick={(e) => { e.stopPropagation(); onRecap(league.id); }}
            className="touch-target text-xs"
          >
            <Trophy className="h-3.5 w-3.5 mr-1" />
            Recap
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={(e) => onResync(e, league.id, league.platform)}
          disabled={refreshingId === league.id}
          className="touch-target"
        >
          {refreshingId === league.id ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              <span className="text-xs">Syncing...</span>
            </>
          ) : (
            <>
              <RefreshCw className="h-4 w-4 mr-2" />
              <span className="text-xs sm:text-sm">Resync</span>
            </>
          )}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(league);
          }}
          disabled={deletingId === league.id}
          className="touch-target text-destructive hover:text-destructive hover:bg-destructive/10"
        >
          {deletingId === league.id ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Trash2 className="h-4 w-4" />
          )}
        </Button>
      </div>
    </div>
  );
};

export const ConnectedLeagues = () => {
  const [leagues, setLeagues] = useState<League[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [leagueToDelete, setLeagueToDelete] = useState<League | null>(null);
  const { toast } = useToast();
  const navigate = useNavigate();
  const { isInSeason } = useSeasonState();

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const getDisplayScoringType = (lg: any) => {
    const defaultType = lg.scoring_type;
    if (lg.platform !== 'espn' || !lg.scoring_settings) return defaultType;
    const items = lg.scoring_settings.scoringItems;
    if (!items) return defaultType;

    let recPoints: number | undefined;
    if (Array.isArray(items)) {
      const recItem = items.find((it: any) => it?.statId === 53);
      recPoints = recItem?.points ?? recItem?.value;
    } else if (typeof items === 'object') {
      const candidate = items['53'] ?? items[53];
      recPoints = candidate?.points ?? candidate?.value ?? candidate;
    }

    if (typeof recPoints !== 'number') return defaultType;
    if (recPoints === 1 || recPoints === 1.0) return 'ppr';
    if (recPoints === 0.5) return 'half_ppr';
    if (recPoints === 0) return 'standard';
    return 'custom';
  };

  useEffect(() => {
    fetchLeagues();
  }, []);

  const fetchLeagues = async () => {
    try {
      const { data, error } = await supabase
        .from('connected_leagues')
        .select('*')
        .order('display_order', { ascending: true });

      if (error) throw error;
      setLeagues(data || []);
    } catch (error: any) {
      console.error('Error fetching leagues:', error);
      toast({
        title: "Error",
        description: "Failed to load leagues",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = leagues.findIndex((l) => l.id === active.id);
      const newIndex = leagues.findIndex((l) => l.id === over.id);

      const newLeagues = arrayMove(leagues, oldIndex, newIndex);
      setLeagues(newLeagues);

      // Update display_order in database
      try {
        const updates = newLeagues.map((league, index) => ({
          id: league.id,
          display_order: index + 1,
        }));

        for (const update of updates) {
          await supabase
            .from('connected_leagues')
            .update({ display_order: update.display_order })
            .eq('id', update.id);
        }
      } catch (error) {
        console.error('Error saving league order:', error);
        toast({
          title: "Error",
          description: "Failed to save league order",
          variant: "destructive",
        });
        // Revert on error
        fetchLeagues();
      }
    }
  };

  const handleQuickResync = async (e: React.MouseEvent, leagueId: string, platform: string) => {
    e.stopPropagation();
    
    setRefreshingId(leagueId);
    try {
      if (platform === 'espn') {
        const { data, error } = await supabase.functions.invoke('resync-espn-league', {
          body: { leagueId }
        });

        if (error) {
          if (error.message?.includes('credentials') || error.message?.includes('expired')) {
            toast({
              title: "Credentials Expired",
              description: "Please reconnect your ESPN league",
              variant: "destructive",
            });
            return;
          }
          throw error;
        }

        toast({
          title: "League Synced",
          description: data?.message || "Your league has been updated",
        });
      } else if (platform === 'sleeper') {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('Not authenticated');

        const { data: profile } = await supabase
          .from('profiles')
          .select('username')
          .eq('id', user.id)
          .single();

        if (!profile?.username) {
          toast({
            title: "Username Required",
            description: "Please set your Sleeper username in Settings first",
            variant: "destructive",
          });
          return;
        }

        const { data, error } = await supabase.functions.invoke('sync-sleeper-league', {
          body: { username: profile.username }
        });

        if (error) throw error;

        toast({
          title: "League Synced",
          description: data?.message || "Your Sleeper league has been updated",
        });
      } else if (platform === 'yahoo') {
        const { data, error } = await supabase.functions.invoke('resync-yahoo-league', {
          body: { leagueId }
        });

        if (error) {
          if (error.message?.includes('credentials') || error.message?.includes('expired')) {
            toast({
              title: "Credentials Expired",
              description: "Please reconnect your Yahoo league",
              variant: "destructive",
            });
            return;
          }
          throw error;
        }

        toast({
          title: "League Synced",
          description: data?.message || "Your Yahoo league has been updated",
        });
      } else {
        toast({
          title: "Not Available",
          description: `Quick resync is not available for ${platform} leagues yet`,
        });
        return;
      }

      await fetchLeagues();
    } catch (error: any) {
      console.error('Error resyncing:', error);
      toast({
        title: "Resync Failed",
        description: "Please try again or reconnect your league",
        variant: "destructive",
      });
    } finally {
      setRefreshingId(null);
    }
  };

  const handleDeleteLeague = async () => {
    if (!leagueToDelete) return;
    
    setDeletingId(leagueToDelete.id);
    try {
      const { error } = await supabase
        .from('connected_leagues')
        .delete()
        .eq('id', leagueToDelete.id);

      if (error) throw error;

      toast({
        title: "League Removed",
        description: `${leagueToDelete.league_name} has been disconnected`,
      });

      await fetchLeagues();
    } catch (error: any) {
      console.error('Error deleting league:', error);
      toast({
        title: "Error",
        description: "Failed to remove league",
        variant: "destructive",
      });
    } finally {
      setDeletingId(null);
      setLeagueToDelete(null);
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </CardContent>
      </Card>
    );
  }

  if (leagues.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No Leagues Connected</CardTitle>
          <CardDescription>Connect your fantasy leagues to get started</CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={() => navigate('/connect-league')} variant="glow" className="w-full">
            <Plus className="mr-2 h-4 w-4" />
            Connect Your First League
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Connected Leagues</CardTitle>
            <CardDescription>Drag to reorder your leagues</CardDescription>
          </div>
          <Button onClick={() => navigate('/connect-league')} variant="outline" size="sm">
            <Plus className="mr-2 h-4 w-4" />
            Add League
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={leagues.map((l) => l.id)}
            strategy={verticalListSortingStrategy}
          >
            {leagues.map((league) => (
              <SortableLeagueItem
                key={league.id}
                league={league}
                refreshingId={refreshingId}
                deletingId={deletingId}
                isOffseason={!isInSeason}
                onResync={handleQuickResync}
                onDelete={setLeagueToDelete}
                onNavigate={(id) => navigate(`/league/${id}`)}
                onRecap={(id) => navigate(`/league/${id}/recap`)}
                getDisplayScoringType={getDisplayScoringType}
              />
            ))}
          </SortableContext>
        </DndContext>
      </CardContent>

      <AlertDialog open={!!leagueToDelete} onOpenChange={(open) => !open && setLeagueToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove League</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove "{leagueToDelete?.league_name}"? This will disconnect your league and remove all synced data.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteLeague}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
};
