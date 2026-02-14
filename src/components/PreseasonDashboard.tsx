import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DraftRankings } from "./preseason/DraftRankings";
import { KeeperAnalysis } from "./preseason/KeeperAnalysis";
import { MockDraftTool } from "./preseason/MockDraftTool";

export function PreseasonDashboard() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold">Pre-Season Prep</h2>
        <p className="text-sm text-muted-foreground">Get ready for the upcoming season with draft tools and keeper analysis.</p>
      </div>

      <Tabs defaultValue="rankings" className="w-full">
        <TabsList className="grid w-full grid-cols-3 max-w-md">
          <TabsTrigger value="rankings" className="text-xs sm:text-sm">
            <span className="hidden sm:inline">Draft Rankings</span>
            <span className="sm:hidden">Rankings</span>
          </TabsTrigger>
          <TabsTrigger value="keepers" className="text-xs sm:text-sm">
            <span className="hidden sm:inline">Keeper Analysis</span>
            <span className="sm:hidden">Keepers</span>
          </TabsTrigger>
          <TabsTrigger value="mock" className="text-xs sm:text-sm">
            <span className="hidden sm:inline">Mock Draft</span>
            <span className="sm:hidden">Mock</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="rankings" className="mt-4">
          <DraftRankings />
        </TabsContent>
        <TabsContent value="keepers" className="mt-4">
          <KeeperAnalysis />
        </TabsContent>
        <TabsContent value="mock" className="mt-4">
          <MockDraftTool />
        </TabsContent>
      </Tabs>
    </div>
  );
}
