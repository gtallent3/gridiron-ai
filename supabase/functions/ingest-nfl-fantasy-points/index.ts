import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3?target=deno';
import { parse } from 'https://deno.land/std@0.224.0/csv/parse.ts';

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

    // Fetch from nflfastR public data repository (nflverse-data releases)
    const url = `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_${season}.csv`;
    
    console.log(`Fetching from: ${url}`);
    
    // Retry logic with exponential backoff for GitHub rate limiting
    let response: Response | null = null;
    let lastError: Error | null = null;
    const maxRetries = 3;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`Fetch attempt ${attempt}/${maxRetries}...`);
        response = await fetch(url);
        
        if (response.ok) {
          console.log('Fetch successful!');
          break;
        }
        
        lastError = new Error(`HTTP ${response.status}: ${response.statusText}`);
        console.warn(`Attempt ${attempt} failed: ${lastError.message}`);
        
        if (attempt < maxRetries) {
          const delayMs = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s
          console.log(`Waiting ${delayMs}ms before retry...`);
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Unknown fetch error');
        console.warn(`Attempt ${attempt} failed: ${lastError.message}`);
        
        if (attempt < maxRetries) {
          const delayMs = Math.pow(2, attempt) * 1000;
          console.log(`Waiting ${delayMs}ms before retry...`);
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }
      }
    }
    
    if (!response || !response.ok) {
      throw lastError || new Error('Failed to fetch data after all retries');
    }

    const csvText = await response.text();

    // Parse CSV using Deno std CSV to handle quoted fields safely
    const rows = await parse(csvText) as string[][];

    if (!rows.length) {
      throw new Error('Empty CSV received');
    }

    const headers = rows[0].map((h) => String(h).trim());
    const dataRows = rows.slice(1);

    console.log(`CSV rows parsed (excluding header): ${dataRows.length}`);

    const getFirst = (row: Record<string, string>, keys: string[]) => {
      for (const k of keys) {
        const v = row[k as keyof typeof row] as unknown as string | undefined;
        if (v !== undefined && v !== null && String(v).length > 0) return v;
      }
      return '';
    };

    const toInt = (v: string | number | null | undefined) => {
      const n = parseInt((v ?? '0') as string, 10);
      return Number.isFinite(n) ? n : 0;
    };

    const toFloat = (v: string | number | null | undefined) => {
      const n = parseFloat((v ?? '0') as string);
      return Number.isFinite(n) ? n : 0;
    };

    const records: any[] = [];

    for (const values of dataRows) {
      const row: Record<string, string> = {};
      for (let i = 0; i < headers.length; i++) {
        row[headers[i]] = (values[i] ?? '').toString().trim();
      }

      const seasonVal = toInt(getFirst(row, ['season']));
      if (seasonVal !== season) continue;

      const week = toInt(getFirst(row, ['week']));
      const player_id = getFirst(row, ['player_id']);
      const player_name = getFirst(row, ['player_display_name', 'player_name']);
      const position = getFirst(row, ['position']);
      const team = getFirst(row, ['recent_team', 'team']);

      if (!player_id || !week) continue;

      const passing_yards = toFloat(getFirst(row, ['passing_yards']));
      const passing_tds = toInt(getFirst(row, ['passing_tds']));
      const passing_ints = toInt(getFirst(row, ['passing_interceptions', 'interceptions']));
      const rushing_yards = toFloat(getFirst(row, ['rushing_yards']));
      const rushing_tds = toInt(getFirst(row, ['rushing_tds']));
      const receiving_yards = toFloat(getFirst(row, ['receiving_yards']));
      const receiving_tds = toInt(getFirst(row, ['receiving_tds']));
      const receptions = toInt(getFirst(row, ['receptions']));

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

    console.log(`Parsed ${records.length} records for season ${season}`);

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

    // Fetch team schedules to enrich opponent data
    console.log('Fetching team schedules to enrich opponent data...');
    const { data: schedules, error: schedError } = await supabase
      .from('team_schedules')
      .select('team, week, opponent')
      .eq('season', season);

    if (schedError) {
      console.error('Error fetching team schedules:', schedError);
    }

    // Create a lookup map: team_week -> opponent
    const scheduleMap = new Map<string, string>();
    if (schedules) {
      for (const sched of schedules) {
        const key = `${sched.team}_${sched.week}`;
        scheduleMap.set(key, sched.opponent);
      }
    }

    // Team abbreviation normalization
    const normalizeTeam = (team: string | null | undefined): string | null => {
      if (!team) return null;
      const normalized: Record<string, string> = {
        'WSH': 'WAS',
        'TAM': 'TB',
        'LVR': 'LV',
        'NOR': 'NO',
        'SFO': 'SF',
        'NWE': 'NE',
        'GNB': 'GB',
        'KAN': 'KC',
        'LAR': 'LA'
      };
      return normalized[team] || team;
    };

    // Enrich records with opponent data from schedules
    console.log('Enriching records with opponent data...');
    for (const record of records) {
      const normalizedTeam = normalizeTeam(record.team);
      const key = `${normalizedTeam}_${record.week}`;
      const opponent = scheduleMap.get(key);
      record.opponent = opponent || null;
    }

    // Insert in batches to avoid timeouts
    const batchSize = 500;
    let totalInserted = 0;

    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize);
      
      const { error } = await supabase
        .from('actual_weekly_points')
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
