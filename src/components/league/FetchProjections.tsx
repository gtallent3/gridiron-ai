import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";

type FetchProjectionsProps = {
  leagueId: string;
};

export function FetchProjections({ leagueId }: FetchProjectionsProps) {
  const { toast } = useToast();
  const [startWeek, setStartWeek] = useState("9");
  const [endWeek, setEndWeek] = useState("18");
  const [isFetching, setIsFetching] = useState(false);

  const handleFetchProjections = async () => {
    const start = parseInt(startWeek);
    const end = parseInt(endWeek);

    if (isNaN(start) || isNaN(end) || start < 1 || end > 18 || start > end) {
      toast({
        title: "Invalid Input",
        description: "Please enter valid week numbers (1-18, start <= end)",
        variant: "destructive",
      });
      return;
    }

    setIsFetching(true);

    try {
      const { data, error } = await supabase.functions.invoke("fetch-espn-projections", {
        body: { leagueId, startWeek: start, endWeek: end },
      });

      if (error) throw error;

      toast({
        title: "Success",
        description: `Fetched projections for weeks ${start}-${end}. ${data?.projections_inserted || 0} projections inserted.`,
      });
    } catch (error: any) {
      console.error("Error fetching projections:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to fetch projections",
        variant: "destructive",
      });
    } finally {
      setIsFetching(false);
    }
  };

  return (
    <Card className="border-primary/20">
      <CardHeader>
        <CardTitle>Fetch Projections</CardTitle>
        <CardDescription>
          Load projected stats for waiver players across multiple weeks
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="startWeek">Start Week</Label>
            <Input
              id="startWeek"
              type="number"
              min="1"
              max="18"
              value={startWeek}
              onChange={(e) => setStartWeek(e.target.value)}
              disabled={isFetching}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="endWeek">End Week</Label>
            <Input
              id="endWeek"
              type="number"
              min="1"
              max="18"
              value={endWeek}
              onChange={(e) => setEndWeek(e.target.value)}
              disabled={isFetching}
            />
          </div>
        </div>
        <Button
          onClick={handleFetchProjections}
          disabled={isFetching}
          className="w-full"
        >
          {isFetching ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Fetching...
            </>
          ) : (
            "Fetch Projections"
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
