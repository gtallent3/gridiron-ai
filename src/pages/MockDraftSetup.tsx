import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Header } from "@/components/Header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Shuffle } from "lucide-react";

const MockDraftSetup = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const [draftType, setDraftType] = useState<"redraft" | "dynasty">("redraft");
  const [scoringType, setScoringType] = useState<"ppr" | "half_ppr" | "standard">("ppr");
  const [numTeams, setNumTeams] = useState(12);
  const [pickTimer, setPickTimer] = useState(0);
  const [userSeat, setUserSeat] = useState(1);

  const numRounds = draftType === "dynasty" ? 25 : 15;

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session?.user) {
        navigate("/auth");
        return;
      }
      setUser(session.user);
      setLoading(false);
    });
  }, [navigate]);

  const handleRandomSeat = () => {
    setUserSeat(Math.floor(Math.random() * numTeams) + 1);
  };

  const handleStartDraft = async () => {
    if (!user || creating) return;
    setCreating(true);

    const { data, error } = await supabase
      .from("mock_drafts")
      .insert({
        user_id: user.id,
        draft_type: draftType,
        scoring_type: scoringType,
        num_teams: numTeams,
        num_rounds: numRounds,
        pick_timer_seconds: pickTimer,
        user_seat: userSeat,
        current_pick: 1,
        status: "active",
      })
      .select("id")
      .single();

    if (error || !data) {
      console.error("Failed to create draft:", error);
      setCreating(false);
      return;
    }

    navigate(`/mock-draft/${data.id}`);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Header user={user} />
      <section className="pt-24 pb-12">
        <div className="container mx-auto px-4">
          <div className="max-w-lg mx-auto">
            <Card>
              <CardHeader>
                <CardTitle className="text-xl">Mock Draft Setup</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Practice your draft strategy against AI opponents
                </p>
              </CardHeader>
              <CardContent className="space-y-5">
                <div>
                  <label className="text-sm text-muted-foreground mb-1.5 block">Draft Type</label>
                  <Select value={draftType} onValueChange={(v) => setDraftType(v as any)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="redraft">Redraft ({15} rounds)</SelectItem>
                      <SelectItem value="dynasty">Dynasty ({25} rounds)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <label className="text-sm text-muted-foreground mb-1.5 block">Scoring</label>
                  <Select value={scoringType} onValueChange={(v) => setScoringType(v as any)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ppr">PPR</SelectItem>
                      <SelectItem value="half_ppr">Half PPR</SelectItem>
                      <SelectItem value="standard">Standard</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <label className="text-sm text-muted-foreground mb-1.5 block">Number of Teams</label>
                  <Select value={String(numTeams)} onValueChange={(v) => {
                    const n = Number(v);
                    setNumTeams(n);
                    if (userSeat > n) setUserSeat(1);
                  }}>
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
                  <label className="text-sm text-muted-foreground mb-1.5 block">Pick Timer</label>
                  <Select value={String(pickTimer)} onValueChange={(v) => setPickTimer(Number(v))}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0">No Timer</SelectItem>
                      <SelectItem value="30">30 seconds</SelectItem>
                      <SelectItem value="60">60 seconds</SelectItem>
                      <SelectItem value="90">90 seconds</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <label className="text-sm text-muted-foreground mb-1.5 block">Your Draft Position</label>
                  <div className="flex gap-2">
                    <Select value={String(userSeat)} onValueChange={(v) => setUserSeat(Number(v))}>
                      <SelectTrigger className="flex-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Array.from({ length: numTeams }, (_, i) => (
                          <SelectItem key={i + 1} value={String(i + 1)}>
                            Pick #{i + 1}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button variant="outline" size="icon" onClick={handleRandomSeat} title="Randomize">
                      <Shuffle className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                <Button
                  onClick={handleStartDraft}
                  disabled={creating}
                  className="w-full"
                  size="lg"
                >
                  {creating ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : null}
                  Start Draft
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>
    </div>
  );
};

export default MockDraftSetup;
