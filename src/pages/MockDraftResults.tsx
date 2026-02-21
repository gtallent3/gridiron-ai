import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Header } from "@/components/Header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DraftBoard } from "@/components/mock-draft/DraftBoard";
import { DraftMyTeam } from "@/components/mock-draft/DraftMyTeam";
import { Loader2, RotateCcw } from "lucide-react";
import { DraftPick } from "@/hooks/useMockDraft";
import { cn } from "@/lib/utils";

interface DraftMeta {
  numTeams: number;
  numRounds: number;
  userSeat: number;
  draftType: string;
  scoringType: string;
}

function computeGrade(
  myPicks: DraftPick[],
  numTeams: number,
  numRounds: number,
  userSeat: number
): { grade: string; score: number; explanation: string } {
  if (myPicks.length === 0) return { grade: "N/A", score: 0, explanation: "No picks" };

  // For each of the user's picks, compute value = pick's ADP - actual draft position
  // Positive value means they got a player later than expected (value pick)
  let totalValue = 0;
  myPicks.forEach((pick) => {
    // Lower ADP = better player. If the player's ADP is lower than where you picked them,
    // that's a value pick.
    const expectedPickForAdp = pick.player.adp;
    const actualPick = pick.pickNumber;
    totalValue += expectedPickForAdp - actualPick;
  });

  // Normalize: average value per pick, scaled relative to league size
  const avgValue = totalValue / myPicks.length;
  const normalized = avgValue / numTeams;

  let grade: string;
  if (normalized >= 2) grade = "A+";
  else if (normalized >= 1.2) grade = "A";
  else if (normalized >= 0.6) grade = "A-";
  else if (normalized >= 0.2) grade = "B+";
  else if (normalized >= -0.2) grade = "B";
  else if (normalized >= -0.6) grade = "B-";
  else if (normalized >= -1.2) grade = "C+";
  else if (normalized >= -2) grade = "C";
  else if (normalized >= -3) grade = "D";
  else grade = "F";

  const explanation =
    totalValue > 0
      ? `You captured ${Math.abs(Math.round(totalValue))} ADP slots of value above expectation.`
      : totalValue < 0
      ? `You reached ${Math.abs(Math.round(totalValue))} ADP slots below expectation.`
      : "Your picks matched ADP expectations exactly.";

  return { grade, score: Math.round(totalValue), explanation };
}

const GRADE_COLORS: Record<string, string> = {
  "A+": "text-green-400",
  A: "text-green-400",
  "A-": "text-green-400",
  "B+": "text-blue-400",
  B: "text-blue-400",
  "B-": "text-blue-400",
  "C+": "text-yellow-400",
  C: "text-yellow-400",
  D: "text-orange-400",
  F: "text-red-400",
};

const MockDraftResults = () => {
  const { draftId } = useParams<{ draftId: string }>();
  const navigate = useNavigate();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [picks, setPicks] = useState<DraftPick[]>([]);
  const [meta, setMeta] = useState<DraftMeta | null>(null);

  useEffect(() => {
    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        navigate("/auth");
        return;
      }
      setUser(session.user);

      if (!draftId) {
        navigate("/mock-draft");
        return;
      }

      const [draftRes, picksRes] = await Promise.all([
        supabase.from("mock_drafts").select("*").eq("id", draftId).single(),
        supabase
          .from("mock_draft_picks")
          .select("*")
          .eq("draft_id", draftId)
          .order("pick_number", { ascending: true }),
      ]);

      if (draftRes.error || !draftRes.data) {
        navigate("/mock-draft");
        return;
      }

      const d = draftRes.data;
      setMeta({
        numTeams: d.num_teams,
        numRounds: d.num_rounds,
        userSeat: d.user_seat,
        draftType: d.draft_type,
        scoringType: d.scoring_type,
      });

      if (picksRes.data) {
        setPicks(
          picksRes.data.map((p: any) => ({
            pickNumber: p.pick_number,
            round: p.round,
            pickInRound: p.pick_in_round,
            seatNumber: p.seat_number,
            isUser: p.is_user,
            player: {
              name: p.player_name,
              position: p.position,
              team: p.team,
              adp: p.adp_rank,
            },
          }))
        );
      }
      setLoading(false);
    };
    load();
  }, [draftId, navigate]);

  if (loading || !meta) {
    return (
      <div className="min-h-screen bg-background">
        <Header user={user} />
        <div className="pt-24 flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </div>
    );
  }

  const myPicks = picks.filter((p) => p.isUser);
  const { grade, score, explanation } = computeGrade(myPicks, meta.numTeams, meta.numRounds, meta.userSeat);
  const gradeColor = GRADE_COLORS[grade] || "text-foreground";

  const getSeatForPick = (overallPick: number) => {
    const round = Math.ceil(overallPick / meta.numTeams);
    const pickInRound = overallPick - (round - 1) * meta.numTeams;
    return round % 2 === 1 ? pickInRound : meta.numTeams - pickInRound + 1;
  };

  return (
    <div className="min-h-screen bg-background">
      <Header user={user} />
      <section className="pt-24 pb-12">
        <div className="container mx-auto px-4">
          <div className="max-w-5xl mx-auto space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-bold">Draft Results</h2>
              <Button variant="outline" onClick={() => navigate("/mock-draft")}>
                <RotateCcw className="h-4 w-4 mr-2" />
                New Draft
              </Button>
            </div>

            {/* Grade card */}
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-6">
                  <div className="text-center">
                    <div className={cn("text-5xl font-black", gradeColor)}>{grade}</div>
                    <div className="text-xs text-muted-foreground mt-1">Draft Grade</div>
                  </div>
                  <div className="flex-1">
                    <p className="text-sm">{explanation}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {meta.numTeams}-team {meta.draftType} | {meta.scoringType.replace("_", " ").toUpperCase()} | Seat #{meta.userSeat}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* My Team */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Your Team</CardTitle>
              </CardHeader>
              <CardContent>
                <DraftMyTeam picks={myPicks} />
              </CardContent>
            </Card>

            {/* Full Draft Board */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Full Draft Board</CardTitle>
              </CardHeader>
              <CardContent>
                <DraftBoard
                  picks={picks}
                  numTeams={meta.numTeams}
                  numRounds={meta.numRounds}
                  currentOverallPick={meta.numTeams * meta.numRounds + 1}
                  userSeat={meta.userSeat}
                  getSeatForPick={getSeatForPick}
                  isActive={false}
                />
              </CardContent>
            </Card>
          </div>
        </div>
      </section>
    </div>
  );
};

export default MockDraftResults;
