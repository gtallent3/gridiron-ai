import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.75.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface PlayerStat {
  player_id: string;
  player_name: string;
  position: string;
  team: string;
  week: number;
  season: number;
  passing_yards: number;
  passing_tds: number;
  passing_ints: number;
  rushing_yards: number;
  rushing_tds: number;
  receiving_yards: number;
  receiving_tds: number;
  receptions: number;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { season = 2025 } = await req.json().catch(() => ({ season: 2025 }));

    console.log(`Fetching NFL fantasy points for season ${season}`);

    // Fetch from nflfastR public data repository
    const url = `https://github.com/nflverse/nflfastR-data/raw/master/data/player_stats_weekly.csv`;
    
    console.log(`Fetching from: ${url}`);
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch data: ${response.statusText}`);
    }

    const csvText = await response.text();
    const lines = csvText.split('\n');
    const headers = lines[0].split(',');
    
    console.log(`CSV headers: ${headers.join(', ')}`);
    console.log(`Total lines: ${lines.length}`);

    const records: any[] = [];
    
    // Parse CSV and filter for the requested season
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const values = line.split(',');
      
      // Extract key fields (adjust indices based on actual CSV structure)
      const seasonVal = parseInt(values[0] || '0');
      if (seasonVal !== season) continue;

      const week = parseInt(values[1] || '0');
      const player_id = values[2] || '';
      const player_name = values[3] || '';
      const position = values[4] || '';
      const team = values[5] || '';
      
      // Stats (adjust indices based on actual CSV structure)
      const passing_yards = parseFloat(values[10] || '0');
      const passing_tds = parseInt(values[11] || '0');
      const passing_ints = parseInt(values[12] || '0');
      const rushing_yards = parseFloat(values[15] || '0');
      const rushing_tds = parseInt(values[16] || '0');
      const receiving_yards = parseFloat(values[20] || '0');
      const receiving_tds = parseInt(values[21] || '0');
      const receptions = parseInt(values[19] || '0');

      // Calculate fantasy points
      const fantasy_points_std = 
        passing_yards * 0.04 +
        passing_tds * 4 +
        passing_ints * -2 +
        rushing_yards * 0.1 +
        rushing_tds * 6 +
        receiving_yards * 0.1 +
        receiving_tds * 6;

      const fantasy_points_ppr = fantasy_points_std + receptions * 1;
      const fantasy_points_half_ppr = fantasy_points_std + receptions * 0.5;

      records.push({
        player_id,
        player_name,
        position,
        team,
        week,
        season: seasonVal,
        passing_yards,
        passing_tds,
        passing_ints,
        rushing_yards,
        rushing_tds,
        receiving_yards,
        receiving_tds,
        receptions,
        fantasy_points_std: parseFloat(fantasy_points_std.toFixed(2)),
        fantasy_points_ppr: parseFloat(fantasy_points_ppr.toFixed(2)),
        fantasy_points_half_ppr: parseFloat(fantasy_points_half_ppr.toFixed(2)),
      });
    }

    console.log(`Parsed ${records.length} player stat records for season ${season}`);

    if (records.length === 0) {
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: `No data found for season ${season}`,
          records_processed: 0 
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Insert in batches to avoid timeouts
    const batchSize = 500;
    let totalInserted = 0;

    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize);
      
      const { error } = await supabase
        .from('nfl_fantasy_points')
        .upsert(batch, { 
          onConflict: 'player_id,week,season',
          ignoreDuplicates: false 
        });

      if (error) {
        console.error(`Error inserting batch ${Math.floor(i / batchSize) + 1}:`, error);
        throw error;
      }

      totalInserted += batch.length;
      console.log(`Inserted batch ${Math.floor(i / batchSize) + 1}: ${batch.length} records`);
    }

    console.log(`Successfully inserted ${totalInserted} records for season ${season}`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: `Successfully ingested ${totalInserted} player stats for season ${season}`,
        records_processed: totalInserted,
        season
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error ingesting NFL fantasy points:', error);
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
