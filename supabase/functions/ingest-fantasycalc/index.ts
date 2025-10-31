import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createErrorResponse, sanitizeError } from "../_shared/errorHandler.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-task-key',
};

const FANTASYCALC_URL = "https://fantasycalc.com/redraft-rankings";
const USER_AGENT = "GridironGM/1.0 (+contact: owner@gtdataandinsights.com)";
const SOURCE = "fantasycalc_redraft";

interface PlayerRow {
  snapshot_date: string;
  source: string;
  player_name: string;
  position: string;
  team: string | null;
  rank: number;
  tier: number | null;
  value_score: number;
  bye_week: number | null;
  player_id_hint: string | null;
  raw_hash: string;
  fetched_at: string;
}

async function checkRobotsTxt(): Promise<boolean> {
  try {
    const response = await fetch("https://fantasycalc.com/robots.txt", {
      headers: { "User-Agent": USER_AGENT }
    });
    
    if (!response.ok) {
      console.warn("Could not fetch robots.txt, assuming allowed");
      return true;
    }
    
    const robotsTxt = await response.text();
    const lines = robotsTxt.toLowerCase().split('\n');
    
    let isUserAgentMatch = false;
    for (const line of lines) {
      const trimmed = line.trim();
      
      if (trimmed.startsWith('user-agent:')) {
        const agent = trimmed.split(':')[1].trim();
        isUserAgentMatch = agent === '*' || agent === 'gridironbm';
      }
      
      if (isUserAgentMatch && trimmed.startsWith('disallow:')) {
        const path = trimmed.split(':')[1].trim();
        if (path === '/redraft-rankings' || path === '/') {
          console.error("robots.txt disallows /redraft-rankings");
          return false;
        }
      }
    }
    
    return true;
  } catch (error) {
    console.error("Error checking robots.txt:", error);
    return true; // Assume allowed on error
  }
}

async function generateHash(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

function parsePlayerCell(text: string): { name: string; position: string; team: string | null } {
  // Expected format: "Bijan Robinson RB - ATL" or "Bijan Robinson RB ATL"
  const match = text.match(/^(.+?)\s+(QB|RB|WR|TE|K|DST)[\s\-]+([A-Z]{2,3})?/);
  
  if (match) {
    return {
      name: match[1].trim(),
      position: match[2],
      team: match[3] || null
    };
  }
  
  // Fallback: try to extract just name and position
  const simpleMatch = text.match(/^(.+?)\s+(QB|RB|WR|TE|K|DST)/);
  if (simpleMatch) {
    return {
      name: simpleMatch[1].trim(),
      position: simpleMatch[2],
      team: null
    };
  }
  
  throw new Error(`Could not parse player cell: ${text}`);
}

async function scrapeFantasyCalc(): Promise<PlayerRow[]> {
  console.log("Fetching FantasyCalc page...");
  
  const response = await fetch(FANTASYCALC_URL, {
    headers: {
      "User-Agent": USER_AGENT,
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    }
  });
  
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  
  const html = await response.text();
  
  // Try to extract JSON data from script tags (fast path)
  const jsonMatch = html.match(/<script[^>]*>(.*?window\.__INITIAL_STATE__\s*=\s*({.*?})\s*;.*?)<\/script>/s);
  if (jsonMatch) {
    console.log("Found initial state JSON, attempting to parse...");
    try {
      const jsonData = JSON.parse(jsonMatch[2]);
      if (jsonData.rankings || jsonData.players) {
        console.log("Successfully extracted JSON data");
        return parseJsonData(jsonData);
      }
    } catch (e) {
      console.warn("Failed to parse JSON data, falling back to DOM parsing");
    }
  }
  
  // Fallback: Parse HTML table
  console.log("Using DOM parsing fallback...");
  return parseHtmlTable(html);
}

function parseJsonData(data: any): PlayerRow[] {
  const snapshotDate = new Date().toISOString().split('T')[0];
  const fetchedAt = new Date().toISOString();
  const players: PlayerRow[] = [];
  
  const rankings = data.rankings || data.players || [];
  
  for (let i = 0; i < rankings.length; i++) {
    const player = rankings[i];
    
    try {
      const row: PlayerRow = {
        snapshot_date: snapshotDate,
        source: SOURCE,
        player_name: player.name || player.player_name,
        position: player.position,
        team: player.team || null,
        rank: player.rank || (i + 1),
        tier: player.tier || null,
        value_score: parseFloat(player.value || player.trade_value || player.ecr || 0),
        bye_week: player.bye_week || player.bye || null,
        player_id_hint: player.id || player.slug || null,
        raw_hash: "",
        fetched_at: fetchedAt
      };
      
      const rawText = `${row.player_name}|${row.position}|${row.team}|${row.rank}|${row.tier}|${row.value_score}|${row.snapshot_date}`;
      row.raw_hash = await generateHash(rawText);
      
      players.push(row);
    } catch (error) {
      console.error("Error parsing player:", player, error);
    }
  }
  
  return players;
}

function parseHtmlTable(html: string): PlayerRow[] {
  // This is a simplified parser - in production you'd want a proper HTML parser
  // For now, we'll return empty and rely on the JSON path
  console.warn("HTML table parsing not fully implemented - please check if JSON path works");
  return [];
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Verify task key for security
    const taskKey = req.headers.get('x-task-key');
    const expectedKey = Deno.env.get('TASK_KEY');
    
    if (taskKey !== expectedKey) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Check if scraping is allowed
    const allowScraping = Deno.env.get('ALLOW_SCRAPING') !== 'false';
    if (!allowScraping) {
      console.log("ALLOW_SCRAPING is disabled");
      return new Response(
        JSON.stringify({ error: 'Scraping is disabled', rows_inserted: 0 }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check robots.txt
    const robotsAllowed = await checkRobotsTxt();
    if (!robotsAllowed) {
      console.error("Scraping disallowed by robots.txt");
      return new Response(
        JSON.stringify({ error: 'Scraping disallowed by robots.txt', rows_inserted: 0 }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Scrape the data
    console.log("Starting FantasyCalc ingestion...");
    const players = await scrapeFantasyCalc();
    
    if (players.length < 100) {
      console.warn(`Warning: Only ${players.length} players found (expected 100+)`);
    }

    // Upsert into database
    let inserted = 0;
    let skipped = 0;
    let errors = 0;

    for (const player of players) {
      try {
        const { error } = await supabase
          .from('trade_values')
          .upsert(player, {
            onConflict: 'source,snapshot_date,player_name,position',
            ignoreDuplicates: false
          });

        if (error) {
          console.error("Error upserting player:", player.player_name, error);
          errors++;
          
          // Log to DLQ
          await supabase
            .from('trade_values_dlq')
            .insert({
              raw_text: JSON.stringify(player),
              error_message: error.message
            });
        } else {
          inserted++;
        }
      } catch (error) {
        console.error("Exception upserting player:", player.player_name, error);
        errors++;
      }

      // Rate limiting: small delay between inserts
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    const summary = {
      success: true,
      rows_found: players.length,
      rows_inserted: inserted,
      rows_skipped: skipped,
      errors: errors,
      snapshot_date: new Date().toISOString().split('T')[0],
      fetched_at: new Date().toISOString()
    };

    console.log("Ingestion complete:", summary);

    // Send to Slack if configured and there are issues
    const slackWebhook = Deno.env.get('SLACK_WEBHOOK_URL');
    if (slackWebhook && (players.length < 100 || errors > 10)) {
      await fetch(slackWebhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: `⚠️ FantasyCalc Ingestion Alert`,
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `*FantasyCalc Ingestion Results*\n• Rows found: ${players.length}\n• Inserted: ${inserted}\n• Errors: ${errors}`
              }
            }
          ]
        })
      }).catch(e => console.error("Failed to send Slack notification:", e));
    }

    return new Response(
      JSON.stringify(summary),
      { 
        status: players.length < 100 ? 206 : 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );

  } catch (error) {
    console.error('Error in ingest-fantasycalc:', error);
    return createErrorResponse(error, 500, corsHeaders);
  }
});
