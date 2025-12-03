import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3?target=deno";

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

    // Log headers to debug column names
    const firstLine = csvText.split('\n')[0];
    console.log(`CSV headers: ${firstLine}`);

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

    // Log first record to see available columns
    console.log('Sample record columns:', Object.keys(records[0]));

    // Build updates - match by player_id, season, week
    let updated = 0;
    let skipped = 0;
    const BATCH_SIZE = 100;

    for (let i = 0; i < records.length; i += BATCH_SIZE) {
      const batch = records.slice(i, i + BATCH_SIZE);
      
      for (const r of batch) {
        const playerId = r.player_id || r.pfr_player_id || r.gsis_id;
        const week = parseInt(r.week) || 0;
        const snapCount = parseInt(r.offense_snaps) || 0;
        const snapPct = parseFloat(r.offense_pct) || 0;

        if (!playerId || !week) {
          skipped++;
          continue;
        }

        // Update existing player_stats record
        const { error } = await supabase
          .from('player_stats')
          .update({
            snap_counts: snapCount,
            snap_pct: snapPct,
            updated_at: new Date().toISOString()
          })
          .eq('player_id', playerId)
          .eq('season', season)
          .eq('week', week);

        if (error) {
          // Record might not exist in player_stats - that's okay
          skipped++;
        } else {
          updated++;
        }
      }

      // Log progress
      if ((i + BATCH_SIZE) % 1000 === 0) {
        console.log(`Processed ${Math.min(i + BATCH_SIZE, records.length)} / ${records.length} records`);
      }
    }

    console.log(`Snap counts update complete: ${updated} records updated, ${skipped} skipped`);

    return new Response(JSON.stringify({
      success: true,
      season,
      total_csv_records: records.length,
      updated,
      skipped,
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
