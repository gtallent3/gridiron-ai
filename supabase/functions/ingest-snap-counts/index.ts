import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Parse CSV text into array of objects
function parseCSV(csvText: string): Record<string, string>[] {
  const lines = csvText.trim().split('\n');
  if (lines.length === 0) return [];
  
  const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
  const records: Record<string, string>[] = [];
  
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    
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

// Normalize player name for matching
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Check authorization
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

    const body = await req.json().catch(() => ({}));
    const season = body.season || 2025;

    console.log(`Fetching nflverse snap counts for season ${season}...`);

    // nflverse snap_counts release
    const url = `https://github.com/nflverse/nflverse-data/releases/download/snap_counts/snap_counts_${season}.csv`;
    
    console.log(`Downloading from: ${url}`);

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch CSV: ${response.status} ${response.statusText}`);
    }

    const csvText = await response.text();
    console.log(`Downloaded ${csvText.length} bytes of CSV data`);

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

    // Build a map of player name + week -> snap data (only offense positions)
    const snapMap = new Map<string, { snapCount: number; snapPct: number }>();
    const offensePositions = ['QB', 'RB', 'WR', 'TE', 'FB', 'HB'];
    
    for (const r of records) {
      const playerName = r.player;
      const week = parseInt(r.week) || 0;
      const position = r.position?.toUpperCase() || '';
      const snapCount = parseInt(r.offense_snaps) || 0;
      const snapPct = parseFloat(r.offense_pct) || 0;

      // Only include offensive skill positions
      if (!playerName || !week || !offensePositions.includes(position)) {
        continue;
      }

      const key = `${normalizeName(playerName)}_${week}`;
      snapMap.set(key, { snapCount, snapPct });
    }

    console.log(`Built snap map with ${snapMap.size} unique player-week entries`);

    // Fetch existing player_stats for this season
    const { data: existingStats, error: fetchError } = await supabase
      .from('player_stats')
      .select('id, player_name, week')
      .eq('season', season);

    if (fetchError) {
      throw new Error(`Failed to fetch player_stats: ${fetchError.message}`);
    }

    console.log(`Found ${existingStats?.length || 0} player_stats records for season ${season}`);

    // Match and prepare updates
    const updates: { id: string; snap_counts: number; snap_pct: number }[] = [];
    
    for (const stat of existingStats || []) {
      const key = `${normalizeName(stat.player_name)}_${stat.week}`;
      const snapData = snapMap.get(key);
      
      if (snapData) {
        updates.push({
          id: stat.id,
          snap_counts: snapData.snapCount,
          snap_pct: snapData.snapPct
        });
      }
    }

    console.log(`Matched ${updates.length} records for update`);

    // Batch update in chunks
    const BATCH_SIZE = 500;
    let updated = 0;
    
    for (let i = 0; i < updates.length; i += BATCH_SIZE) {
      const batch = updates.slice(i, i + BATCH_SIZE);
      
      // Use upsert with id to update existing records
      for (const update of batch) {
        const { error: updateError } = await supabase
          .from('player_stats')
          .update({
            snap_counts: update.snap_counts,
            snap_pct: update.snap_pct,
            updated_at: new Date().toISOString()
          })
          .eq('id', update.id);

        if (!updateError) {
          updated++;
        }
      }

      console.log(`Updated batch ${Math.floor(i / BATCH_SIZE) + 1}, total updated: ${updated}`);
    }

    console.log(`Snap counts update complete: ${updated} records updated`);

    return new Response(JSON.stringify({
      success: true,
      season,
      total_csv_records: records.length,
      snap_map_entries: snapMap.size,
      matched: updates.length,
      updated,
      message: `Updated ${updated} player_stats records with snap count data`
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('Error in ingest-snap-counts:', error);
    return new Response(JSON.stringify({ 
      error: error.message,
      success: false 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
