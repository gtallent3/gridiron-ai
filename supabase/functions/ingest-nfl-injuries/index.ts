import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-task-key',
};

// Injury code explanations
const INJURY_CODE_EXPLANATIONS: Record<string, string> = {
  "ACT": "Active",
  "INA": "Inactive for game",
  "RET": "Retired",
  "CUT": "Released/Cut from roster",
  "EXE": "Exempt list",
  "TRD": "N/A",
  "TRC": "N/A",
  "QST": "Questionable",
  "OUT": "Out (will not play)",
  "DNL": "Did Not List",
  "NA": "Not Active",
  "SUS": "Suspended",
  "IR": "Injured Reserve",
  "IR-P": "Injured Reserve - Designated to Return",
  "PUP": "Physically Unable to Perform",
  "NFI": "Non-Football Injury",
  "DEV": "Practice Squad",
  "RES": "Reserve List",
  "Q": "Questionable",
  "D": "Doubtful",
  "O": "Out",
  "DNP": "Did Not Practice",
  "LP": "Limited Participant",
  "FP": "Full Participant",
  "P01": "Practice report entry 1",
  "P02": "Practice report entry 2",
  "P03": "Practice report entry 3",
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Authorization check
    const taskKey = req.headers.get('x-task-key');
    const authHeader = req.headers.get('Authorization');
    
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    let isAuthorized = false;

    if (taskKey === Deno.env.get('TASK_KEY')) {
      isAuthorized = true;
      console.log('Authorized via TASK_KEY');
    } else if (authHeader) {
      const jwt = authHeader.replace('Bearer ', '');
      const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(jwt);
      
      if (user && !userError) {
        const { data: roles } = await supabaseAdmin
          .from('user_roles')
          .select('role')
          .eq('user_id', user.id)
          .eq('role', 'admin');
        
        if (roles && roles.length > 0) {
          isAuthorized = true;
          console.log('Authorized via admin role');
        }
      }
    }

    if (!isAuthorized) {
      console.error('Unauthorized access attempt');
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Parse request body for season parameter
    let season = 2025;
    try {
      const body = await req.json();
      if (body.season) season = body.season;
    } catch {
      // Use default season
    }

    console.log(`Fetching NFL injury data for season ${season}`);

    // Build nflverse URL
    const csvUrl = `https://github.com/nflverse/nflverse-data/releases/download/weekly_rosters/roster_weekly_${season}.csv`;
    console.log(`Fetching from: ${csvUrl}`);

    // Fetch CSV data
    const response = await fetch(csvUrl);
    
    if (!response.ok) {
      if (response.status === 404) {
        return new Response(JSON.stringify({ 
          error: `Roster data not found for season ${season}`,
          status: 404 
        }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      throw new Error(`Failed to fetch CSV: ${response.status} ${response.statusText}`);
    }

    const csvText = await response.text();
    console.log(`Fetched CSV with ${csvText.length} characters`);

    // Parse CSV
    const lines = csvText.split('\n');
    const headers = parseCSVLine(lines[0]);
    
    console.log(`CSV Headers: ${headers.join(', ')}`);

    // Find column indices
    const firstNameIdx = headers.indexOf('first_name');
    const lastNameIdx = headers.indexOf('last_name');
    const teamIdx = headers.indexOf('team');
    const weekIdx = headers.indexOf('week');
    const statusIdx = headers.indexOf('status');
    const statusDescIdx = headers.indexOf('status_description_abbr');

    if (firstNameIdx === -1 || lastNameIdx === -1) {
      throw new Error('Required columns (first_name, last_name) not found in CSV');
    }

    console.log(`Column indices - first_name: ${firstNameIdx}, last_name: ${lastNameIdx}, team: ${teamIdx}, week: ${weekIdx}, status: ${statusIdx}, status_desc: ${statusDescIdx}`);

    // Process rows
    const records: Array<{
      player_name: string;
      team: string | null;
      week: number;
      season: number;
      status: string | null;
      status_description: string;
      status_explanation: string;
    }> = [];

    const seenKeys = new Set<string>();

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const values = parseCSVLine(line);
      
      const firstName = values[firstNameIdx]?.trim() || '';
      const lastName = values[lastNameIdx]?.trim() || '';
      
      // Skip rows with missing player name
      if (!firstName && !lastName) continue;
      
      const playerName = `${firstName} ${lastName}`.trim();
      const team = values[teamIdx]?.trim() || null;
      const week = parseInt(values[weekIdx], 10) || 0;
      const status = values[statusIdx]?.trim() || null;
      const statusDescription = values[statusDescIdx]?.trim() || '';
      
      // Get explanation from lookup table
      const statusExplanation = status ? (INJURY_CODE_EXPLANATIONS[status] || '') : '';

      // Skip invalid weeks
      if (week < 1 || week > 22) continue;

      // Deduplicate by player_name + team + week
      const key = `${playerName}|${team}|${week}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);

      records.push({
        player_name: playerName,
        team,
        week,
        season,
        status,
        status_description: statusDescription,
        status_explanation: statusExplanation
      });
    }

    console.log(`Parsed ${records.length} injury records`);

    // Upsert in batches
    const batchSize = 500;
    let insertedCount = 0;

    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize);
      
      const { error } = await supabaseAdmin
        .from('player_injury_status')
        .upsert(batch, { 
          onConflict: 'player_name,team,week,season',
          ignoreDuplicates: false 
        });

      if (error) {
        console.error(`Batch upsert error at ${i}:`, error);
        throw error;
      }

      insertedCount += batch.length;
      console.log(`Upserted batch ${Math.floor(i / batchSize) + 1}: ${insertedCount}/${records.length}`);
    }

    console.log(`Successfully ingested ${insertedCount} injury records for season ${season}`);

    return new Response(JSON.stringify({
      success: true,
      season,
      total_records: insertedCount,
      message: `Ingested ${insertedCount} injury records for season ${season}`
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Error in ingest-nfl-injuries:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ 
      error: errorMessage,
      success: false 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

// Helper function to parse CSV line handling quoted fields
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  
  result.push(current);
  return result;
}
