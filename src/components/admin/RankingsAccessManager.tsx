import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Lock, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";

type RankingsAccessManagerProps = {
  selectedUserId: string;
  onSuccess: () => void;
};

export function RankingsAccessManager({ selectedUserId, onSuccess }: RankingsAccessManagerProps) {
  const { toast } = useToast();
  const [currentWeek, setCurrentWeek] = useState(10);
  const [durationDays, setDurationDays] = useState(7);
  const [granting, setGranting] = useState(false);
  const [userAccess, setUserAccess] = useState<{
    rankings_unlocked_week: number | null;
    rankings_unlocked_at: string | null;
  } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (selectedUserId) {
      fetchUserAccess();
    } else {
      setUserAccess(null);
    }
  }, [selectedUserId]);

  const fetchUserAccess = async () => {
    if (!selectedUserId) return;
    
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("user_tokens")
        .select("rankings_unlocked_week, rankings_unlocked_at")
        .eq("user_id", selectedUserId)
        .single();

      if (error) throw error;
      setUserAccess(data);
    } catch (error) {
      console.error("Error fetching user access:", error);
    } finally {
      setLoading(false);
    }
  };

  const calculateTimeRemaining = () => {
    if (!userAccess?.rankings_unlocked_at) return null;
    
    const unlockedAt = new Date(userAccess.rankings_unlocked_at);
    const expiresAt = new Date(unlockedAt.getTime() + 7 * 24 * 60 * 60 * 1000);
    const now = new Date();
    const timeLeft = expiresAt.getTime() - now.getTime();
    
    if (timeLeft <= 0) return "Expired";
    
    const days = Math.floor(timeLeft / (1000 * 60 * 60 * 24));
    const hours = Math.floor((timeLeft % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    
    return `${days}d ${hours}h remaining`;
  };

  const handleGrantAccess = async () => {
    if (!selectedUserId) {
      toast({
        title: "Select User",
        description: "Please select a user first",
        variant: "destructive",
      });
      return;
    }

    setGranting(true);
    try {
      const { data, error } = await supabase.functions.invoke("admin-grant-rankings-access", {
        body: {
          userId: selectedUserId,
          currentWeek,
          durationDays,
        },
      });

      if (error) throw error;

      toast({
        title: "Rankings Access Granted",
        description: `User now has ${durationDays} days of rankings access`,
      });

      fetchUserAccess();
      onSuccess();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to grant rankings access",
        variant: "destructive",
      });
    } finally {
      setGranting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Lock className="h-5 w-5" />
          Grant Rankings Access
        </CardTitle>
        <CardDescription>Give users temporary access to positional rankings</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {selectedUserId && userAccess && !loading && (
          <div className="p-3 bg-muted rounded-lg space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Current Access Status</span>
              <Badge variant={userAccess.rankings_unlocked_week ? "default" : "outline"}>
                {userAccess.rankings_unlocked_week ? `Week ${userAccess.rankings_unlocked_week}` : "No Access"}
              </Badge>
            </div>
            {userAccess.rankings_unlocked_at && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Clock className="h-4 w-4" />
                {calculateTimeRemaining()}
              </div>
            )}
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="week">Week</Label>
          <Input
            id="week"
            type="number"
            min="1"
            max="18"
            value={currentWeek}
            onChange={(e) => setCurrentWeek(parseInt(e.target.value) || 1)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="duration">Access Duration</Label>
          <Select
            value={durationDays.toString()}
            onValueChange={(value) => setDurationDays(parseInt(value))}
          >
            <SelectTrigger id="duration">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">1 Day</SelectItem>
              <SelectItem value="3">3 Days</SelectItem>
              <SelectItem value="7">7 Days (1 Week)</SelectItem>
              <SelectItem value="14">14 Days (2 Weeks)</SelectItem>
              <SelectItem value="30">30 Days (1 Month)</SelectItem>
              <SelectItem value="90">90 Days (3 Months)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Button
          onClick={handleGrantAccess}
          disabled={!selectedUserId || granting}
          className="w-full"
        >
          {granting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Granting Access...
            </>
          ) : (
            "Grant Rankings Access"
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
