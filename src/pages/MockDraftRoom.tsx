import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Header } from "@/components/Header";
import { useMockDraft, DraftSettings } from "@/hooks/useMockDraft";
import { DraftBoard } from "@/components/mock-draft/DraftBoard";
import { DraftPlayerList } from "@/components/mock-draft/DraftPlayerList";
import { DraftMyTeam } from "@/components/mock-draft/DraftMyTeam";
import { DraftTimer } from "@/components/mock-draft/DraftTimer";
import { DraftPickBanner } from "@/components/mock-draft/DraftPickBanner";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = ["Board", "Players", "My Team"] as const;
type Tab = (typeof TABS)[number];

const MockDraftRoom = () => {
  const { draftId } = useParams<{ draftId: string }>();
  const navigate = useNavigate();
  const [user, setUser] = useState<any>(null);
  const [settings, setSettings] = useState<DraftSettings | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [mobileTab, setMobileTab] = useState<Tab>("Players");

  // Load draft settings from DB
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

      const { data, error } = await supabase
        .from("mock_drafts")
        .select("*")
        .eq("id", draftId)
        .single();

      if (error || !data) {
        setLoadError(true);
        return;
      }

      setSettings({
        draftId: data.id,
        draftType: data.draft_type as "redraft" | "dynasty",
        scoringType: data.scoring_type as "ppr" | "half_ppr" | "standard",
        numTeams: data.num_teams,
        numRounds: data.num_rounds,
        pickTimerSeconds: data.pick_timer_seconds,
        userSeat: data.user_seat,
      });
    };
    load();
  }, [draftId, navigate]);

  const {
    draftState,
    availablePlayers,
    picks,
    myPicks,
    isUserTurn,
    isDraftComplete,
    timeRemaining,
    makePick,
    isLoading,
    latestPick,
    numTeams,
    numRounds,
    userSeat,
    getSeatForPick,
  } = useMockDraft(settings);

  // Navigate to results when draft completes
  useEffect(() => {
    if (isDraftComplete && draftId) {
      const timer = setTimeout(() => {
        navigate(`/mock-draft/${draftId}/results`);
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [isDraftComplete, draftId, navigate]);

  if (loadError) {
    return (
      <div className="min-h-screen bg-background">
        <Header user={user} />
        <div className="pt-24 flex items-center justify-center">
          <p className="text-muted-foreground">Draft not found.</p>
        </div>
      </div>
    );
  }

  if (!settings || isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <Header user={user} />
        <div className="pt-24 flex flex-col items-center justify-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Loading players...</p>
        </div>
      </div>
    );
  }

  const statusBar = (
    <div className="flex items-center justify-between gap-3 px-4 py-2 bg-card border-b border-border">
      <div className="flex items-center gap-3 text-sm">
        <span className="text-muted-foreground">
          Rd {draftState.currentRound}/{numRounds}
        </span>
        <span className="text-muted-foreground">
          Pick {draftState.currentOverallPick}/{numTeams * numRounds}
        </span>
        {isUserTurn && (
          <span className="text-primary font-semibold animate-pulse">Your Pick!</span>
        )}
        {isDraftComplete && (
          <span className="text-primary font-semibold">Draft Complete!</span>
        )}
      </div>
      {settings.pickTimerSeconds > 0 && isUserTurn && (
        <div className="w-32">
          <DraftTimer timeRemaining={timeRemaining} totalTime={settings.pickTimerSeconds} />
        </div>
      )}
    </div>
  );

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header user={user} />
      <DraftPickBanner pick={latestPick} />

      <div className="pt-16 flex flex-col flex-1 min-h-0">
        {statusBar}

        {/* Desktop layout */}
        <div className="hidden md:flex flex-1 min-h-0">
          <div className="w-[60%] border-r border-border overflow-auto p-3">
            <DraftBoard
              picks={picks}
              numTeams={numTeams}
              numRounds={numRounds}
              currentOverallPick={draftState.currentOverallPick}
              userSeat={userSeat}
              getSeatForPick={getSeatForPick}
              isActive={draftState.status === "active"}
            />
          </div>
          <div className="w-[40%] flex flex-col min-h-0">
            <DesktopRightPanel
              availablePlayers={availablePlayers}
              isUserTurn={isUserTurn}
              makePick={makePick}
              myPicks={myPicks}
            />
          </div>
        </div>

        {/* Mobile layout */}
        <div className="flex md:hidden flex-col flex-1 min-h-0">
          <div className="flex border-b border-border bg-card">
            {TABS.map((tab) => (
              <button
                key={tab}
                onClick={() => setMobileTab(tab)}
                className={cn(
                  "flex-1 py-2.5 text-sm font-medium text-center transition-colors",
                  mobileTab === tab
                    ? "text-primary border-b-2 border-primary"
                    : "text-muted-foreground"
                )}
              >
                {tab}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-auto p-3">
            {mobileTab === "Board" && (
              <DraftBoard
                picks={picks}
                numTeams={numTeams}
                numRounds={numRounds}
                currentOverallPick={draftState.currentOverallPick}
                userSeat={userSeat}
                getSeatForPick={getSeatForPick}
                isActive={draftState.status === "active"}
              />
            )}
            {mobileTab === "Players" && (
              <DraftPlayerList
                players={availablePlayers}
                isUserTurn={isUserTurn}
                onDraft={makePick}
              />
            )}
            {mobileTab === "My Team" && <DraftMyTeam picks={myPicks} />}
          </div>
        </div>
      </div>
    </div>
  );
};

function DesktopRightPanel({
  availablePlayers,
  isUserTurn,
  makePick,
  myPicks,
}: {
  availablePlayers: any[];
  isUserTurn: boolean;
  makePick: (p: any) => void;
  myPicks: any[];
}) {
  const [tab, setTab] = useState<"Players" | "My Team">("Players");

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex border-b border-border bg-card">
        {(["Players", "My Team"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "flex-1 py-2 text-sm font-medium text-center transition-colors",
              tab === t
                ? "text-primary border-b-2 border-primary"
                : "text-muted-foreground"
            )}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-auto p-3">
        {tab === "Players" ? (
          <DraftPlayerList
            players={availablePlayers}
            isUserTurn={isUserTurn}
            onDraft={makePick}
          />
        ) : (
          <DraftMyTeam picks={myPicks} />
        )}
      </div>
    </div>
  );
}

export default MockDraftRoom;
