import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3?target=deno";
import { getCorsHeaders } from "../_shared/cors.ts";


// Parse CSV text into array of objects
function parseCSV(csvText: string): Record<string, string>[] {
  const lines = csvText.trim().split('\n');
  if (lines.length === 0) return [];
  
  // Parse header row
  const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
  
  const records: Record<string, string>[] = [];
  
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    
    // Simple CSV parsing (handles basic cases)
    const values: string[] = [];
    let current = '';
    let inQuotes = false;
    
    for (const char of line) {
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        values.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    values.push(current.trim());
    
    const record: Record<string, string> = {};
    headers.forEach((header, idx) => {
      record[header] = values[idx] || '';
    });
    
    records.push(record);
  }
  
  return records;
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Check authorization - allow task key or admin user
    const authHeader = req.headers.get('authorization') || req.headers.get('Authorization');
    const taskKey = req.headers.get('x-task-key');
    const validTaskKey = Deno.env.get('TASK_KEY');

    if (taskKey !== validTaskKey) {
      if (!authHeader) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const token = authHeader.replace('Bearer ', '');
      const { data: { user }, error: authError } = await supabase.auth.getUser(token);

      if (authError || !user) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Check admin role
      const { data: roleData } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id)
        .eq('role', 'admin')
        .single();

      if (!roleData) {
        return new Response(JSON.stringify({ error: 'Admin access required' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // Parse request body
    const body = await req.json().catch(() => ({}));
    const season = body.season || 2025;

    console.log(`Fetching nflverse player stats for season ${season}...`);

    // Build the nflverse URL - using stats_player release tag and stats_player_week file pattern
    const url = `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_${season}.csv`;
    
    console.log(`Downloading from: ${url}`);

    // Fetch the CSV
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch CSV: ${response.status} ${response.statusText}`);
    }

    const csvText = await response.text();
    console.log(`Downloaded ${csvText.length} bytes of CSV data`);

    // Parse CSV
    const records = parseCSV(csvText);
    console.log(`Parsed ${records.length} records from CSV`);

    if (records.length === 0) {
      return new Response(JSON.stringify({ 
        success: true, 
        message: 'No records found in CSV',
        processed: 0 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Map and clean data
    const playerStats = records
      .filter(r => r.player_id && r.player_name) // Drop rows missing player_id or player_name
      .map(r => ({
        player_id: r.player_id,
        player_name: r.player_name,
        player_display_name: r.player_display_name || null,
        team: r.recent_team || r.team || null,
        position: r.position || null,
        position_group: r.position_group || null,
        season: parseInt(r.season) || season,
        week: parseInt(r.week) || 0,
        headshot_url: r.headshot_url || null,
        opponent_team: r.opponent_team || null,
        // Passing stats
        completions: parseInt(r.completions) || 0,
        attempts: parseInt(r.attempts) || 0,
        passing_yards: parseFloat(r.passing_yards) || 0,
        passing_tds: parseInt(r.passing_tds) || 0,
        passing_interceptions: parseInt(r.interceptions) || 0,
        passing_air_yards: parseFloat(r.passing_air_yards) || 0,
        passing_epa: parseFloat(r.passing_epa) || 0,
        // Rushing stats
        carries: parseInt(r.carries) || 0,
        rushing_yards: parseFloat(r.rushing_yards) || 0,
        rushing_tds: parseInt(r.rushing_tds) || 0,
        rushing_epa: parseFloat(r.rushing_epa) || 0,
        // Receiving stats
        targets: parseInt(r.targets) || 0,
        receptions: parseInt(r.receptions) || 0,
        receiving_yards: parseFloat(r.receiving_yards) || 0,
        receiving_tds: parseInt(r.receiving_tds) || 0,
        receiving_air_yards: parseFloat(r.receiving_air_yards) || 0,
        receiving_epa: parseFloat(r.receiving_epa) || 0,
        target_share: parseFloat(r.target_share) || 0,
        // Snap counts - NOTE: not available in stats_player_week CSV, would need snap_counts release
        snap_counts: 0,
        snap_pct: 0,
        routes_run: 0,
        // Fantasy points
        fantasy_points: parseFloat(r.fantasy_points) || 0,
        fantasy_points_ppr: parseFloat(r.fantasy_points_ppr) || 0,
        updated_at: new Date().toISOString(),
      }));

    // Deduplicate by (player_id, season, week)
    const seen = new Set<string>();
    const uniqueStats = playerStats.filter(p => {
      const key = `${p.player_id}-${p.season}-${p.week}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    console.log(`Prepared ${uniqueStats.length} unique player stats records`);

    // Upsert in batches
    const BATCH_SIZE = 500;
    let processed = 0;
    let errors = 0;

    for (let i = 0; i < uniqueStats.length; i += BATCH_SIZE) {
      const batch = uniqueStats.slice(i, i + BATCH_SIZE);
      
      const { error } = await supabase
        .from('player_stats')
        .upsert(batch, { 
          onConflict: 'player_id,season,week',
          ignoreDuplicates: false 
        });

      if (error) {
        console.error(`Batch ${Math.floor(i / BATCH_SIZE) + 1} error:`, error);
        errors++;
      } else {
        processed += batch.length;
      }
    }

    console.log(`Ingestion complete: ${processed} records processed, ${errors} batch errors`);

    return new Response(JSON.stringify({
      success: true,
      season,
      total_csv_records: records.length,
      processed,
      batch_errors: errors,
      message: `Successfully ingested ${processed} player stats for season ${season}`
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('Error in ingest-player-stats:', error);
    return new Response(JSON.stringify({ 
      error: error.message,
      success: false 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
