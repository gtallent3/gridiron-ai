import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3?target=deno';
import { getCorsHeaders } from "../_shared/cors.ts";


Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { season = 2025 } = await req.json().catch(() => ({ season: 2025 }));

    console.log(`Starting team schedules ingestion for season ${season}`);

    // Hardcoded CSV data
    const csvData = `TEAM,W1,W2,W3,W4,W5,W6,W7,W8,W9,W10,W11,W12,W13,W14,W15,W16,W17,W18
ARI,@NOR,CAR,@SFO,SEA,TEN,@IND,GNB,BYE,@DAL,@SEA,SFO,JAX,@TAM,LAR,@HOU,ATL,@CIN,@LAR
ATL,TAM,@MIN,@CAR,WSH,BYE,BUF,@SFO,MIA,@NWE,@IND,CAR,@NOR,@NYJ,SEA,@TAM,@ARI,LAR,NOR
BAL,@BUF,CLE,DET,@KAN,HOU,LAR,BYE,CHI,@MIA,@MIN,@CLE,NYJ,CIN,PIT,@CIN,NWE,@GNB,@PIT
BUF,BAL,@NYJ,MIA,NOR,NWE,@ATL,BYE,@CAR,KAN,@MIA,TAM,@HOU,@PIT,CIN,@NWE,@CLE,PHI,NYJ
CAR,@JAX,@ARI,ATL,@NWE,MIA,DAL,@NYJ,BUF,@GNB,NOR,@ATL,@SFO,LAR,BYE,@NOR,TAM,SEA,@TAM
CHI,MIN,@DET,DAL,@LVR,BYE,@WSH,NOR,@BAL,@CIN,NYG,@MIN,PIT,@PHI,@GNB,CLE,GNB,@SFO,DET
CIN,@CLE,JAX,@MIN,@DEN,DET,@GNB,PIT,NYJ,CHI,BYE,@PIT,NWE,@BAL,@BUF,BAL,@MIA,ARI,CLE
CLE,CIN,@BAL,GNB,@DET,MIN,@PIT,MIA,@NWE,BYE,@NYJ,BAL,@LVR,SFO,TEN,@CHI,BUF,PIT,@CIN
DAL,@PHI,NYG,@CHI,GNB,@NYJ,@CAR,WSH,@DEN,ARI,BYE,@LVR,PHI,KAN,@DET,MIN,LAC,@WSH,@NYG
DEN,TEN,@IND,@LAC,CIN,@PHI,@NYJ,NYG,DAL,@HOU,LVR,KAN,BYE,@WSH,@LVR,GNB,JAX,@KAN,LAC
DET,@GNB,CHI,@BAL,CLE,@CIN,@KAN,TAM,BYE,MIN,@WSH,@PHI,NYG,GNB,DAL,@LAR,PIT,@MIN,@CHI
GNB,DET,WSH,@CLE,@DAL,BYE,CIN,@ARI,@PIT,CAR,PHI,@NYG,MIN,@DET,CHI,@DEN,@CHI,BAL,@MIN
HOU,@LAR,TAM,@JAX,TEN,@BAL,BYE,@SEA,SFO,DEN,JAX,@TEN,BUF,@IND,@KAN,ARI,LVR,@LAC,IND
IND,MIA,DEN,@TEN,@LAR,LVR,ARI,@LAC,TEN,@PIT,ATL,BYE,@KAN,HOU,@JAX,@SEA,SFO,JAX,@HOU
JAX,CAR,@CIN,HOU,@SFO,KAN,SEA,LAR,BYE,@LVR,@HOU,LAC,@ARI,@TEN,IND,NYJ,@DEN,@IND,TEN
KAN,@LAC,PHI,@NYG,BAL,@JAX,DET,LVR,WSH,@BUF,BYE,@DEN,IND,@DAL,HOU,LAC,@TEN,DEN,@LVR
LVR,@NWE,LAC,@WSH,CHI,@IND,TEN,@KAN,BYE,JAX,@DEN,DAL,CLE,@LAC,DEN,@PHI,@HOU,NYG,KAN
LAR,HOU,@TEN,@PHI,IND,SFO,@BAL,@JAX,BYE,NOR,@SFO,SEA,TAM,@CAR,@ARI,DET,@SEA,@ATL,ARI
LAC,KAN,@LVR,DEN,@NYG,WSH,@MIA,IND,MIN,@TEN,PIT,@JAX,BYE,LVR,PHI,@KAN,@DAL,HOU,@DEN
MIA,@IND,NWE,@BUF,NYJ,@CAR,LAC,@CLE,@ATL,BAL,BUF,WSH,BYE,NOR,@NYJ,@PIT,CIN,TAM,@NWE
MIN,@CHI,ATL,CIN,@PIT,@CLE,BYE,PHI,@LAC,@DET,BAL,CHI,@GNB,@SEA,WSH,@DAL,@NYG,DET,GNB
NWE,LVR,@MIA,PIT,CAR,@BUF,@NOR,@TEN,CLE,ATL,@TAM,NYJ,@CIN,NYG,BYE,BUF,@BAL,@NYJ,MIA
NOR,ARI,SFO,@SEA,@BUF,NYG,NWE,@CHI,TAM,@LAR,@CAR,BYE,ATL,@MIA,@TAM,CAR,NYJ,@TEN,@ATL
NYG,@WSH,@DAL,KAN,LAC,@NOR,PHI,@DEN,@PHI,SFO,@CHI,GNB,@DET,@NWE,BYE,WSH,MIN,@LVR,DAL
NYJ,PIT,BUF,@TAM,@MIA,DAL,DEN,CAR,@CIN,BYE,CLE,@NWE,@BAL,ATL,MIA,@JAX,@NOR,NWE,@BUF
PHI,DAL,@KAN,LAR,@TAM,DEN,@NYG,@MIN,NYG,BYE,@GNB,DET,@DAL,CHI,@LAC,LVR,@WSH,@BUF,WSH
PIT,@NYJ,SEA,@NWE,MIN,BYE,CLE,@CIN,GNB,IND,@LAC,CIN,@CHI,BUF,@BAL,MIA,@DET,@CLE,BAL
SFO,@SEA,@NOR,ARI,JAX,@LAR,@TAM,ATL,@HOU,@NYG,LAR,@ARI,CAR,@CLE,BYE,TEN,@IND,CHI,SEA
SEA,SFO,@PIT,NOR,@ARI,TAM,@JAX,HOU,BYE,@WSH,ARI,@LAR,@TEN,MIN,@ATL,IND,LAR,@CAR,@SFO
TAM,@ATL,@HOU,NYJ,PHI,@SEA,SFO,@DET,@NOR,BYE,NWE,@BUF,@LAR,ARI,NOR,ATL,@CAR,@MIA,CAR
TEN,@DEN,LAR,IND,@HOU,@ARI,@LVR,NWE,@IND,LAC,BYE,HOU,SEA,JAX,@CLE,@SFO,KAN,NOR,@JAX
WSH,NYG,@GNB,LVR,@ATL,@LAC,CHI,@DAL,@KAN,SEA,DET,@MIA,BYE,DEN,@MIN,@NYG,PHI,DAL,@PHI`;

    const lines = csvData.trim().split('\n');
    const headers = lines[0].split(',');
    
    const records: any[] = [];

    // Parse each team's schedule
    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',');
      const team = values[0];
      
      // Process weeks 1-18
      for (let week = 1; week <= 18; week++) {
        const matchup = values[week];
        
        if (matchup === 'BYE') {
          continue; // Skip bye weeks
        }
        
        const isHome = !matchup.startsWith('@');
        const opponent = isHome ? matchup : matchup.substring(1);
        
        records.push({
          team,
          week,
          opponent,
          is_home: isHome,
          season
        });
      }
    }

    console.log(`Parsed ${records.length} schedule records for ${season}`);

    // Upsert into database
    const { data, error } = await supabase
      .from('team_schedules')
      .upsert(records, {
        onConflict: 'team,week,season',
        ignoreDuplicates: false
      });

    if (error) {
      console.error('Database error:', error);
      throw error;
    }

    console.log(`Successfully ingested ${records.length} team schedule records`);

    return new Response(
      JSON.stringify({
        success: true,
        records: records.length,
        season
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in ingest-team-schedules:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    return new Response(
      JSON.stringify({
        success: false,
        error: errorMessage
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
