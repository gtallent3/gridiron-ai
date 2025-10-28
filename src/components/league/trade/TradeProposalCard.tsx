import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeftRight, TrendingUp, TrendingDown, ArrowUp } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type TradeProposalCardProps = {
  proposal: any;
  league: any;
  userTeam: any;
};

export function TradeProposalCard({ proposal }: TradeProposalCardProps) {
  const valueDiff = proposal.valueDiff || 0;
  const isPositive = valueDiff >= 0;
  const isBalanced = Math.abs(valueDiff) < 5;

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex-1">
            <div className="text-sm font-medium mb-1">You Give</div>
            {proposal.myPlayers.map((p: any, idx: number) => (
              <div key={idx} className="text-sm">
                {p.name} <Badge variant="outline" className="ml-1">{p.position}</Badge>
              </div>
            ))}
          </div>

          <div className="flex flex-col items-center gap-2">
            <ArrowLeftRight className="h-5 w-5 text-muted-foreground" />
            <Badge variant={isBalanced ? "secondary" : isPositive ? "default" : "destructive"}>
              {isPositive ? "+" : ""}{valueDiff.toFixed(1)}
            </Badge>
          </div>

          <div className="flex-1">
            <div className="text-sm font-medium mb-1">You Get</div>
            {proposal.theirPlayers.map((p: any, idx: number) => (
              <div key={idx} className="text-sm">
                {p.name} <Badge variant="outline" className="ml-1">{p.position}</Badge>
              </div>
            ))}
            {proposal.theirTeam && (
              <div className="text-xs text-muted-foreground mt-1">
                from {proposal.theirTeam.team_name}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            {isPositive ? (
              <TrendingUp className="h-4 w-4 text-green-500" />
            ) : (
              <TrendingDown className="h-4 w-4 text-red-500" />
            )}
            <span className="text-sm font-medium">
              {proposal.type}
            </span>
          </div>
        </div>

        {proposal.rationale && (
          <div className="mt-3 pt-3 border-t text-sm text-muted-foreground">
            {proposal.rationale}
          </div>
        )}

        <div className="mt-3 flex flex-wrap gap-2">
          {proposal.positionGain !== undefined && (
            <Badge variant="secondary">
              Position Gain: +{proposal.positionGain.toFixed(1)} pts
            </Badge>
          )}
          
          {proposal.improvesWeakPosition && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge variant="default" className="flex items-center gap-1 cursor-help">
                    <ArrowUp className="w-3 h-3" />
                    Addresses Weakness
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-xs">This trade improves a weak position on your roster</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}

          {proposal.targetRank && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge variant="outline" className="cursor-help">
                    Current Rank: {proposal.targetRank}
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>
                  <div className="text-xs space-y-1">
                    <p>Position Rank: {proposal.targetRank}</p>
                    {proposal.targetZScore && (
                      <p>Z-Score: {proposal.targetZScore.toFixed(2)}</p>
                    )}
                  </div>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}

          {proposal.tradeFitScore !== undefined && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge 
                    variant={proposal.tradeFitScore > 0.6 ? "default" : "secondary"}
                    className="cursor-help"
                  >
                    Fit Score: {proposal.tradeFitScore.toFixed(2)}
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-xs">
                    Trade fit score based on rank improvement, z-score gain, and value efficiency
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}

          {proposal.estimatedRankImprovement && (
            <Badge variant="secondary" className="flex items-center gap-1">
              <ArrowUp className="w-3 h-3 text-green-500" />
              Est. +{proposal.estimatedRankImprovement} rank
            </Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
