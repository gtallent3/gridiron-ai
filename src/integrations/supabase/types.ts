export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      account_links: {
        Row: {
          created_at: string | null
          decided_at: string | null
          decided_by: string | null
          id: string
          primary_user_id: string | null
          requested_by: string | null
          secondary_user_id: string | null
          status: string | null
        }
        Insert: {
          created_at?: string | null
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          primary_user_id?: string | null
          requested_by?: string | null
          secondary_user_id?: string | null
          status?: string | null
        }
        Update: {
          created_at?: string | null
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          primary_user_id?: string | null
          requested_by?: string | null
          secondary_user_id?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "account_links_primary_user_id_fkey"
            columns: ["primary_user_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "account_links_secondary_user_id_fkey"
            columns: ["secondary_user_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      ai_rate_limits: {
        Row: {
          created_at: string
          endpoint: string
          id: string
          request_count: number
          user_id: string
          window_start: string
        }
        Insert: {
          created_at?: string
          endpoint: string
          id?: string
          request_count?: number
          user_id: string
          window_start?: string
        }
        Update: {
          created_at?: string
          endpoint?: string
          id?: string
          request_count?: number
          user_id?: string
          window_start?: string
        }
        Relationships: []
      }
      app_users: {
        Row: {
          auth_provider: string | null
          cancel_at: string | null
          created_at: string | null
          current_plan: string | null
          email: string | null
          is_banned: boolean | null
          period_end: string | null
          phone: string | null
          renewed_at: string | null
          risk_score: number | null
          stripe_customer_id: string | null
          sub_status: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          auth_provider?: string | null
          cancel_at?: string | null
          created_at?: string | null
          current_plan?: string | null
          email?: string | null
          is_banned?: boolean | null
          period_end?: string | null
          phone?: string | null
          renewed_at?: string | null
          risk_score?: number | null
          stripe_customer_id?: string | null
          sub_status?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          auth_provider?: string | null
          cancel_at?: string | null
          created_at?: string | null
          current_plan?: string | null
          email?: string | null
          is_banned?: boolean | null
          period_end?: string | null
          phone?: string | null
          renewed_at?: string | null
          risk_score?: number | null
          stripe_customer_id?: string | null
          sub_status?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      connected_leagues: {
        Row: {
          auto_refresh: boolean | null
          created_at: string | null
          current_week: number | null
          id: string
          last_synced_at: string | null
          league_id: string
          league_name: string
          league_size: number | null
          opponent_team_id: string | null
          platform: Database["public"]["Enums"]["league_platform"]
          scoring_settings: Json | null
          scoring_type: Database["public"]["Enums"]["scoring_type"]
          updated_at: string | null
          user_id: string
          user_team_id: string | null
        }
        Insert: {
          auto_refresh?: boolean | null
          created_at?: string | null
          current_week?: number | null
          id?: string
          last_synced_at?: string | null
          league_id: string
          league_name: string
          league_size?: number | null
          opponent_team_id?: string | null
          platform: Database["public"]["Enums"]["league_platform"]
          scoring_settings?: Json | null
          scoring_type: Database["public"]["Enums"]["scoring_type"]
          updated_at?: string | null
          user_id: string
          user_team_id?: string | null
        }
        Update: {
          auto_refresh?: boolean | null
          created_at?: string | null
          current_week?: number | null
          id?: string
          last_synced_at?: string | null
          league_id?: string
          league_name?: string
          league_size?: number | null
          opponent_team_id?: string | null
          platform?: Database["public"]["Enums"]["league_platform"]
          scoring_settings?: Json | null
          scoring_type?: Database["public"]["Enums"]["scoring_type"]
          updated_at?: string | null
          user_id?: string
          user_team_id?: string | null
        }
        Relationships: []
      }
      defensive_rankings: {
        Row: {
          avg_points_allowed: number | null
          created_at: string | null
          fantasy_points_allowed: number | null
          games_played: number | null
          id: string
          position: string
          rank: number | null
          season: number
          tds_allowed: number | null
          team: string
          updated_at: string | null
          week: number
          yards_allowed: number | null
        }
        Insert: {
          avg_points_allowed?: number | null
          created_at?: string | null
          fantasy_points_allowed?: number | null
          games_played?: number | null
          id?: string
          position: string
          rank?: number | null
          season?: number
          tds_allowed?: number | null
          team: string
          updated_at?: string | null
          week: number
          yards_allowed?: number | null
        }
        Update: {
          avg_points_allowed?: number | null
          created_at?: string | null
          fantasy_points_allowed?: number | null
          games_played?: number | null
          id?: string
          position?: string
          rank?: number | null
          season?: number
          tds_allowed?: number | null
          team?: string
          updated_at?: string | null
          week?: number
          yards_allowed?: number | null
        }
        Relationships: []
      }
      devices: {
        Row: {
          device_id: string
          fingerprint: string
          first_seen: string | null
          ip_inet: unknown
          last_seen: string | null
          ua: string | null
          user_id: string | null
        }
        Insert: {
          device_id?: string
          fingerprint: string
          first_seen?: string | null
          ip_inet?: unknown
          last_seen?: string | null
          ua?: string | null
          user_id?: string | null
        }
        Update: {
          device_id?: string
          fingerprint?: string
          first_seen?: string | null
          ip_inet?: unknown
          last_seen?: string | null
          ua?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "devices_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      espn_credentials: {
        Row: {
          created_at: string | null
          espn_s2_encrypted: string
          expires_at: string | null
          id: string
          last_synced_at: string | null
          league_id: string
          swid_encrypted: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          espn_s2_encrypted: string
          expires_at?: string | null
          id?: string
          last_synced_at?: string | null
          league_id: string
          swid_encrypted: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          espn_s2_encrypted?: string
          expires_at?: string | null
          id?: string
          last_synced_at?: string | null
          league_id?: string
          swid_encrypted?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      fetch_metadata: {
        Row: {
          created_at: string | null
          endpoint_type: string
          error_count: number | null
          fetch_count: number | null
          id: string
          last_error: string | null
          last_fetched_at: string
          league_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          endpoint_type: string
          error_count?: number | null
          fetch_count?: number | null
          id?: string
          last_error?: string | null
          last_fetched_at?: string
          league_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          endpoint_type?: string
          error_count?: number | null
          fetch_count?: number | null
          id?: string
          last_error?: string | null
          last_fetched_at?: string
          league_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fetch_metadata_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "connected_leagues"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          amount_due: number
          amount_paid: number
          created_at: string | null
          currency: string | null
          hosted_invoice_url: string | null
          id: string
          invoice_pdf: string | null
          status: string
          stripe_invoice_id: string
          user_id: string | null
        }
        Insert: {
          amount_due: number
          amount_paid: number
          created_at?: string | null
          currency?: string | null
          hosted_invoice_url?: string | null
          id?: string
          invoice_pdf?: string | null
          status: string
          stripe_invoice_id: string
          user_id?: string | null
        }
        Update: {
          amount_due?: number
          amount_paid?: number
          created_at?: string | null
          currency?: string | null
          hosted_invoice_url?: string | null
          id?: string
          invoice_pdf?: string | null
          status?: string
          stripe_invoice_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoices_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      league_credentials: {
        Row: {
          created_at: string | null
          id: string
          league_id: string
          platform: string
          updated_at: string | null
          user_id: string
          vault_secret_name: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          league_id: string
          platform: string
          updated_at?: string | null
          user_id: string
          vault_secret_name: string
        }
        Update: {
          created_at?: string | null
          id?: string
          league_id?: string
          platform?: string
          updated_at?: string | null
          user_id?: string
          vault_secret_name?: string
        }
        Relationships: []
      }
      league_transactions: {
        Row: {
          comments: string | null
          created_at: string | null
          external_transaction_id: string | null
          faab_spent: number | null
          id: string
          league_id: string
          player_names: string[] | null
          players_involved: Json
          raw_data: Json | null
          teams_involved: Json
          trade_partner: string | null
          transaction_date: string
          transaction_type: string
          updated_at: string | null
        }
        Insert: {
          comments?: string | null
          created_at?: string | null
          external_transaction_id?: string | null
          faab_spent?: number | null
          id?: string
          league_id: string
          player_names?: string[] | null
          players_involved?: Json
          raw_data?: Json | null
          teams_involved?: Json
          trade_partner?: string | null
          transaction_date: string
          transaction_type: string
          updated_at?: string | null
        }
        Update: {
          comments?: string | null
          created_at?: string | null
          external_transaction_id?: string | null
          faab_spent?: number | null
          id?: string
          league_id?: string
          player_names?: string[] | null
          players_involved?: Json
          raw_data?: Json | null
          teams_involved?: Json
          trade_partner?: string | null
          transaction_date?: string
          transaction_type?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "league_transactions_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "connected_leagues"
            referencedColumns: ["id"]
          },
        ]
      }
      leagues: {
        Row: {
          created_at: string
          id: string
          last_synced_at: string
          name: string
          platform: string
          platform_league_id: string
          roster_data: Json | null
          season: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_synced_at?: string
          name: string
          platform: string
          platform_league_id: string
          roster_data?: Json | null
          season: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          last_synced_at?: string
          name?: string
          platform?: string
          platform_league_id?: string
          roster_data?: Json | null
          season?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      nfl_fantasy_points: {
        Row: {
          created_at: string | null
          fantasy_points_half_ppr: number | null
          fantasy_points_ppr: number | null
          fantasy_points_std: number | null
          id: string
          opponent: string | null
          passing_ints: number | null
          passing_tds: number | null
          passing_yards: number | null
          player_id: string
          player_name: string
          position: string | null
          receiving_tds: number | null
          receiving_yards: number | null
          receptions: number | null
          rushing_tds: number | null
          rushing_yards: number | null
          season: number
          team: string | null
          updated_at: string | null
          week: number
        }
        Insert: {
          created_at?: string | null
          fantasy_points_half_ppr?: number | null
          fantasy_points_ppr?: number | null
          fantasy_points_std?: number | null
          id?: string
          opponent?: string | null
          passing_ints?: number | null
          passing_tds?: number | null
          passing_yards?: number | null
          player_id: string
          player_name: string
          position?: string | null
          receiving_tds?: number | null
          receiving_yards?: number | null
          receptions?: number | null
          rushing_tds?: number | null
          rushing_yards?: number | null
          season?: number
          team?: string | null
          updated_at?: string | null
          week: number
        }
        Update: {
          created_at?: string | null
          fantasy_points_half_ppr?: number | null
          fantasy_points_ppr?: number | null
          fantasy_points_std?: number | null
          id?: string
          opponent?: string | null
          passing_ints?: number | null
          passing_tds?: number | null
          passing_yards?: number | null
          player_id?: string
          player_name?: string
          position?: string | null
          receiving_tds?: number | null
          receiving_yards?: number | null
          receptions?: number | null
          rushing_tds?: number | null
          rushing_yards?: number | null
          season?: number
          team?: string | null
          updated_at?: string | null
          week?: number
        }
        Relationships: []
      }
      normalized_players: {
        Row: {
          created_at: string | null
          espn_id: string | null
          id: string
          player_id: string
          player_name: string
          position: string
          sleeper_id: string | null
          stats: Json | null
          team: string | null
          updated_at: string | null
          yahoo_id: string | null
        }
        Insert: {
          created_at?: string | null
          espn_id?: string | null
          id?: string
          player_id: string
          player_name: string
          position: string
          sleeper_id?: string | null
          stats?: Json | null
          team?: string | null
          updated_at?: string | null
          yahoo_id?: string | null
        }
        Update: {
          created_at?: string | null
          espn_id?: string | null
          id?: string
          player_id?: string
          player_name?: string
          position?: string
          sleeper_id?: string | null
          stats?: Json | null
          team?: string | null
          updated_at?: string | null
          yahoo_id?: string | null
        }
        Relationships: []
      }
      payment_fingerprints: {
        Row: {
          fingerprint: string
          first_used: string | null
          id: string
          last_used: string | null
          stripe_payment_method_id: string | null
          user_id: string | null
        }
        Insert: {
          fingerprint: string
          first_used?: string | null
          id?: string
          last_used?: string | null
          stripe_payment_method_id?: string | null
          user_id?: string | null
        }
        Update: {
          fingerprint?: string
          first_used?: string | null
          id?: string
          last_used?: string | null
          stripe_payment_method_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_fingerprints_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      player_pool: {
        Row: {
          applied_breakdown: Json | null
          confidence: number | null
          created_at: string | null
          espn_league_id: string
          id: string
          is_owned: boolean
          league_id: string
          percent_owned: number | null
          percent_started: number | null
          player_id: string
          player_name: string
          position: string
          projected_fp: number | null
          provider_ids: Json | null
          season: number
          source: string | null
          stats: Json | null
          team: string | null
          updated_at: string | null
          waiver_status: string | null
          week: number
        }
        Insert: {
          applied_breakdown?: Json | null
          confidence?: number | null
          created_at?: string | null
          espn_league_id: string
          id?: string
          is_owned?: boolean
          league_id: string
          percent_owned?: number | null
          percent_started?: number | null
          player_id: string
          player_name: string
          position: string
          projected_fp?: number | null
          provider_ids?: Json | null
          season: number
          source?: string | null
          stats?: Json | null
          team?: string | null
          updated_at?: string | null
          waiver_status?: string | null
          week: number
        }
        Update: {
          applied_breakdown?: Json | null
          confidence?: number | null
          created_at?: string | null
          espn_league_id?: string
          id?: string
          is_owned?: boolean
          league_id?: string
          percent_owned?: number | null
          percent_started?: number | null
          player_id?: string
          player_name?: string
          position?: string
          projected_fp?: number | null
          provider_ids?: Json | null
          season?: number
          source?: string | null
          stats?: Json | null
          team?: string | null
          updated_at?: string | null
          waiver_status?: string | null
          week?: number
        }
        Relationships: []
      }
      player_stats: {
        Row: {
          blocked_kicks: number | null
          confidence: number | null
          conflict_flags: Json | null
          created_at: string | null
          defensive_tds: number | null
          fg_attempts: number | null
          fg_made: number | null
          fg_made_0_19: number | null
          fg_made_20_29: number | null
          fg_made_30_39: number | null
          fg_made_40_49: number | null
          fg_made_50_plus: number | null
          finalized: boolean | null
          freshness_ts: string | null
          fumble_recovery_tds: number | null
          fumbles_forced: number | null
          fumbles_lost: number | null
          fumbles_recovered: number | null
          id: string
          interception_tds: number | null
          interceptions: number | null
          kick_return_tds: number | null
          market_rank: number | null
          passing_2pt_conversions: number | null
          passing_attempts: number | null
          passing_completions: number | null
          passing_tds: number | null
          passing_yards: number | null
          percent_owned: number | null
          percent_started: number | null
          player_id: string
          player_name: string
          points_allowed: number | null
          position: string
          provider_ids: Json | null
          punt_return_tds: number | null
          raw_data: Json | null
          receiving_2pt_conversions: number | null
          receiving_targets: number | null
          receiving_tds: number | null
          receiving_yards: number | null
          receptions: number | null
          reconciled_version: number | null
          rushing_2pt_conversions: number | null
          rushing_attempts: number | null
          rushing_tds: number | null
          rushing_yards: number | null
          sacks: number | null
          safeties: number | null
          season: number
          source: string
          source_type: string | null
          team: string | null
          updated_at: string | null
          waiver_status: string | null
          week: number
          xp_attempts: number | null
          xp_made: number | null
          yards_allowed: number | null
        }
        Insert: {
          blocked_kicks?: number | null
          confidence?: number | null
          conflict_flags?: Json | null
          created_at?: string | null
          defensive_tds?: number | null
          fg_attempts?: number | null
          fg_made?: number | null
          fg_made_0_19?: number | null
          fg_made_20_29?: number | null
          fg_made_30_39?: number | null
          fg_made_40_49?: number | null
          fg_made_50_plus?: number | null
          finalized?: boolean | null
          freshness_ts?: string | null
          fumble_recovery_tds?: number | null
          fumbles_forced?: number | null
          fumbles_lost?: number | null
          fumbles_recovered?: number | null
          id?: string
          interception_tds?: number | null
          interceptions?: number | null
          kick_return_tds?: number | null
          market_rank?: number | null
          passing_2pt_conversions?: number | null
          passing_attempts?: number | null
          passing_completions?: number | null
          passing_tds?: number | null
          passing_yards?: number | null
          percent_owned?: number | null
          percent_started?: number | null
          player_id: string
          player_name: string
          points_allowed?: number | null
          position: string
          provider_ids?: Json | null
          punt_return_tds?: number | null
          raw_data?: Json | null
          receiving_2pt_conversions?: number | null
          receiving_targets?: number | null
          receiving_tds?: number | null
          receiving_yards?: number | null
          receptions?: number | null
          reconciled_version?: number | null
          rushing_2pt_conversions?: number | null
          rushing_attempts?: number | null
          rushing_tds?: number | null
          rushing_yards?: number | null
          sacks?: number | null
          safeties?: number | null
          season: number
          source: string
          source_type?: string | null
          team?: string | null
          updated_at?: string | null
          waiver_status?: string | null
          week: number
          xp_attempts?: number | null
          xp_made?: number | null
          yards_allowed?: number | null
        }
        Update: {
          blocked_kicks?: number | null
          confidence?: number | null
          conflict_flags?: Json | null
          created_at?: string | null
          defensive_tds?: number | null
          fg_attempts?: number | null
          fg_made?: number | null
          fg_made_0_19?: number | null
          fg_made_20_29?: number | null
          fg_made_30_39?: number | null
          fg_made_40_49?: number | null
          fg_made_50_plus?: number | null
          finalized?: boolean | null
          freshness_ts?: string | null
          fumble_recovery_tds?: number | null
          fumbles_forced?: number | null
          fumbles_lost?: number | null
          fumbles_recovered?: number | null
          id?: string
          interception_tds?: number | null
          interceptions?: number | null
          kick_return_tds?: number | null
          market_rank?: number | null
          passing_2pt_conversions?: number | null
          passing_attempts?: number | null
          passing_completions?: number | null
          passing_tds?: number | null
          passing_yards?: number | null
          percent_owned?: number | null
          percent_started?: number | null
          player_id?: string
          player_name?: string
          points_allowed?: number | null
          position?: string
          provider_ids?: Json | null
          punt_return_tds?: number | null
          raw_data?: Json | null
          receiving_2pt_conversions?: number | null
          receiving_targets?: number | null
          receiving_tds?: number | null
          receiving_yards?: number | null
          receptions?: number | null
          reconciled_version?: number | null
          rushing_2pt_conversions?: number | null
          rushing_attempts?: number | null
          rushing_tds?: number | null
          rushing_yards?: number | null
          sacks?: number | null
          safeties?: number | null
          season?: number
          source?: string
          source_type?: string | null
          team?: string | null
          updated_at?: string | null
          waiver_status?: string | null
          week?: number
          xp_attempts?: number | null
          xp_made?: number | null
          yards_allowed?: number | null
        }
        Relationships: []
      }
      player_valuations: {
        Row: {
          championship_weeks_projection: number | null
          confidence_score: number | null
          created_at: string | null
          id: string
          injury_duration_weeks: number | null
          injury_risk: number | null
          injury_status: string | null
          is_bye_week: boolean | null
          last_updated_at: string | null
          next_3_weeks_projection: number
          player_id: string
          player_name: string
          player_value: number
          playoff_schedule_difficulty: number | null
          position: Database["public"]["Enums"]["player_position"]
          ppg_projection: number
          remaining_bye_weeks: number | null
          remaining_schedule: Json | null
          role_stability: number | null
          ros_projection: number
          schedule_difficulty: number | null
          season: number
          sentiment_score: number | null
          team: string | null
          updated_at: string | null
          usage_trend: number | null
          volatility_flag: boolean | null
          week: number
        }
        Insert: {
          championship_weeks_projection?: number | null
          confidence_score?: number | null
          created_at?: string | null
          id?: string
          injury_duration_weeks?: number | null
          injury_risk?: number | null
          injury_status?: string | null
          is_bye_week?: boolean | null
          last_updated_at?: string | null
          next_3_weeks_projection?: number
          player_id: string
          player_name: string
          player_value?: number
          playoff_schedule_difficulty?: number | null
          position: Database["public"]["Enums"]["player_position"]
          ppg_projection?: number
          remaining_bye_weeks?: number | null
          remaining_schedule?: Json | null
          role_stability?: number | null
          ros_projection?: number
          schedule_difficulty?: number | null
          season: number
          sentiment_score?: number | null
          team?: string | null
          updated_at?: string | null
          usage_trend?: number | null
          volatility_flag?: boolean | null
          week: number
        }
        Update: {
          championship_weeks_projection?: number | null
          confidence_score?: number | null
          created_at?: string | null
          id?: string
          injury_duration_weeks?: number | null
          injury_risk?: number | null
          injury_status?: string | null
          is_bye_week?: boolean | null
          last_updated_at?: string | null
          next_3_weeks_projection?: number
          player_id?: string
          player_name?: string
          player_value?: number
          playoff_schedule_difficulty?: number | null
          position?: Database["public"]["Enums"]["player_position"]
          ppg_projection?: number
          remaining_bye_weeks?: number | null
          remaining_schedule?: Json | null
          role_stability?: number | null
          ros_projection?: number
          schedule_difficulty?: number | null
          season?: number
          sentiment_score?: number | null
          team?: string | null
          updated_at?: string | null
          usage_trend?: number | null
          volatility_flag?: boolean | null
          week?: number
        }
        Relationships: []
      }
      player_value_cache: {
        Row: {
          consistency_multiplier: number
          created_at: string
          id: string
          league_id: string
          player_id: string
          player_name: string
          position: string
          projected_fp_ros: number
          risk_adjustment: number
          schedule_factor: number
          team: string | null
          updated_at: string
          value_score: number
        }
        Insert: {
          consistency_multiplier?: number
          created_at?: string
          id?: string
          league_id: string
          player_id: string
          player_name: string
          position: string
          projected_fp_ros?: number
          risk_adjustment?: number
          schedule_factor?: number
          team?: string | null
          updated_at?: string
          value_score?: number
        }
        Update: {
          consistency_multiplier?: number
          created_at?: string
          id?: string
          league_id?: string
          player_id?: string
          player_name?: string
          position?: string
          projected_fp_ros?: number
          risk_adjustment?: number
          schedule_factor?: number
          team?: string | null
          updated_at?: string
          value_score?: number
        }
        Relationships: [
          {
            foreignKeyName: "player_value_cache_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "connected_leagues"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          id: string
          updated_at: string
          username: string
        }
        Insert: {
          created_at?: string
          id: string
          updated_at?: string
          username: string
        }
        Update: {
          created_at?: string
          id?: string
          updated_at?: string
          username?: string
        }
        Relationships: []
      }
      projected_player_stats: {
        Row: {
          applied_breakdown: Json | null
          confidence: number | null
          created_at: string | null
          id: string
          last_updated: string
          market_rank: number | null
          percent_owned: number | null
          percent_started: number | null
          player_id: string
          player_name: string
          position: string
          projected_fp: number | null
          provider_ids: Json | null
          season: number
          source: string
          stats: Json
          status_flags: Json | null
          team: string | null
          waiver_status: string | null
          week: number
        }
        Insert: {
          applied_breakdown?: Json | null
          confidence?: number | null
          created_at?: string | null
          id?: string
          last_updated?: string
          market_rank?: number | null
          percent_owned?: number | null
          percent_started?: number | null
          player_id: string
          player_name: string
          position: string
          projected_fp?: number | null
          provider_ids?: Json | null
          season: number
          source?: string
          stats?: Json
          status_flags?: Json | null
          team?: string | null
          waiver_status?: string | null
          week: number
        }
        Update: {
          applied_breakdown?: Json | null
          confidence?: number | null
          created_at?: string | null
          id?: string
          last_updated?: string
          market_rank?: number | null
          percent_owned?: number | null
          percent_started?: number | null
          player_id?: string
          player_name?: string
          position?: string
          projected_fp?: number | null
          provider_ids?: Json | null
          season?: number
          source?: string
          stats?: Json
          status_flags?: Json | null
          team?: string | null
          waiver_status?: string | null
          week?: number
        }
        Relationships: []
      }
      prop_bets: {
        Row: {
          created_at: string
          id: string
          multiplier: number
          payout_amount: number | null
          potential_payout: number
          prop_id: string
          selection: string
          settled_at: string | null
          status: Database["public"]["Enums"]["prop_status"]
          tokens_wagered: number
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          multiplier: number
          payout_amount?: number | null
          potential_payout: number
          prop_id: string
          selection: string
          settled_at?: string | null
          status?: Database["public"]["Enums"]["prop_status"]
          tokens_wagered: number
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          multiplier?: number
          payout_amount?: number | null
          potential_payout?: number
          prop_id?: string
          selection?: string
          settled_at?: string | null
          status?: Database["public"]["Enums"]["prop_status"]
          tokens_wagered?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "prop_bets_prop_id_fkey"
            columns: ["prop_id"]
            isOneToOne: false
            referencedRelation: "weekly_props"
            referencedColumns: ["id"]
          },
        ]
      }
      risk_events: {
        Row: {
          created_at: string | null
          event_type: string
          id: number
          meta: Json | null
          reason: string | null
          risk_score: number | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          event_type: string
          id?: number
          meta?: Json | null
          reason?: string | null
          risk_score?: number | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          event_type?: string
          id?: number
          meta?: Json | null
          reason?: string | null
          risk_score?: number | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "risk_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      roster_snapshots: {
        Row: {
          age: number | null
          created_at: string | null
          draft_round: number | null
          draft_year: number | null
          id: string
          is_starter: boolean | null
          league_id: string
          player_id: string
          player_name: string | null
          position: string | null
          roster_status: string | null
          snapshot_date: string
          team: string | null
          team_id: string
        }
        Insert: {
          age?: number | null
          created_at?: string | null
          draft_round?: number | null
          draft_year?: number | null
          id?: string
          is_starter?: boolean | null
          league_id: string
          player_id: string
          player_name?: string | null
          position?: string | null
          roster_status?: string | null
          snapshot_date?: string
          team?: string | null
          team_id: string
        }
        Update: {
          age?: number | null
          created_at?: string | null
          draft_round?: number | null
          draft_year?: number | null
          id?: string
          is_starter?: boolean | null
          league_id?: string
          player_id?: string
          player_name?: string | null
          position?: string | null
          roster_status?: string | null
          snapshot_date?: string
          team?: string | null
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "roster_snapshots_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "connected_leagues"
            referencedColumns: ["id"]
          },
        ]
      }
      signup_rate_limits: {
        Row: {
          attempt_count: number | null
          id: string
          identifier: string
          identifier_type: string
          window_start: string | null
        }
        Insert: {
          attempt_count?: number | null
          id?: string
          identifier: string
          identifier_type: string
          window_start?: string | null
        }
        Update: {
          attempt_count?: number | null
          id?: string
          identifier?: string
          identifier_type?: string
          window_start?: string | null
        }
        Relationships: []
      }
      sleeper_projections: {
        Row: {
          created_at: string | null
          id: string
          opponent: string | null
          opponent_def_rank: number | null
          pass_int: number | null
          pass_td: number | null
          pass_yd: number | null
          player_id: string
          player_name: string | null
          playoff_sos_rank: number | null
          position: string | null
          pts_half_ppr: number | null
          pts_ppr: number | null
          pts_std: number | null
          raw_stats: Json | null
          rec: number | null
          rec_td: number | null
          rec_yd: number | null
          ros_sos_rank: number | null
          rush_td: number | null
          rush_yd: number | null
          season: number
          team: string | null
          updated_at: string | null
          week: number
        }
        Insert: {
          created_at?: string | null
          id?: string
          opponent?: string | null
          opponent_def_rank?: number | null
          pass_int?: number | null
          pass_td?: number | null
          pass_yd?: number | null
          player_id: string
          player_name?: string | null
          playoff_sos_rank?: number | null
          position?: string | null
          pts_half_ppr?: number | null
          pts_ppr?: number | null
          pts_std?: number | null
          raw_stats?: Json | null
          rec?: number | null
          rec_td?: number | null
          rec_yd?: number | null
          ros_sos_rank?: number | null
          rush_td?: number | null
          rush_yd?: number | null
          season: number
          team?: string | null
          updated_at?: string | null
          week: number
        }
        Update: {
          created_at?: string | null
          id?: string
          opponent?: string | null
          opponent_def_rank?: number | null
          pass_int?: number | null
          pass_td?: number | null
          pass_yd?: number | null
          player_id?: string
          player_name?: string | null
          playoff_sos_rank?: number | null
          position?: string | null
          pts_half_ppr?: number | null
          pts_ppr?: number | null
          pts_std?: number | null
          raw_stats?: Json | null
          rec?: number | null
          rec_td?: number | null
          rec_yd?: number | null
          ros_sos_rank?: number | null
          rush_td?: number | null
          rush_yd?: number | null
          season?: number
          team?: string | null
          updated_at?: string | null
          week?: number
        }
        Relationships: []
      }
      strength_of_schedule: {
        Row: {
          avg_points_allowed_qb: number | null
          avg_points_allowed_rb: number | null
          avg_points_allowed_te: number | null
          avg_points_allowed_wr: number | null
          created_at: string | null
          def_rank_qb: number | null
          def_rank_rb: number | null
          def_rank_te: number | null
          def_rank_wr: number | null
          id: string
          opponent: string | null
          season: number
          team: string
          updated_at: string | null
          week: number | null
        }
        Insert: {
          avg_points_allowed_qb?: number | null
          avg_points_allowed_rb?: number | null
          avg_points_allowed_te?: number | null
          avg_points_allowed_wr?: number | null
          created_at?: string | null
          def_rank_qb?: number | null
          def_rank_rb?: number | null
          def_rank_te?: number | null
          def_rank_wr?: number | null
          id?: string
          opponent?: string | null
          season?: number
          team: string
          updated_at?: string | null
          week?: number | null
        }
        Update: {
          avg_points_allowed_qb?: number | null
          avg_points_allowed_rb?: number | null
          avg_points_allowed_te?: number | null
          avg_points_allowed_wr?: number | null
          created_at?: string | null
          def_rank_qb?: number | null
          def_rank_rb?: number | null
          def_rank_te?: number | null
          def_rank_wr?: number | null
          id?: string
          opponent?: string | null
          season?: number
          team?: string
          updated_at?: string | null
          week?: number | null
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          cancel_at_period_end: boolean | null
          created_at: string | null
          current_period_end: string | null
          current_period_start: string | null
          id: string
          plan_id: string
          status: string
          stripe_subscription_id: string
          trial_end: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          cancel_at_period_end?: boolean | null
          created_at?: string | null
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          plan_id: string
          status: string
          stripe_subscription_id: string
          trial_end?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          cancel_at_period_end?: boolean | null
          created_at?: string | null
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          plan_id?: string
          status?: string
          stripe_subscription_id?: string
          trial_end?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      team_positional_strengths: {
        Row: {
          created_at: string
          delta_vs_median: number
          id: string
          league_id: string
          position: string
          pss: number
          rank: number
          team_id: string
          updated_at: string
          z_score: number
        }
        Insert: {
          created_at?: string
          delta_vs_median?: number
          id?: string
          league_id: string
          position: string
          pss?: number
          rank?: number
          team_id: string
          updated_at?: string
          z_score?: number
        }
        Update: {
          created_at?: string
          delta_vs_median?: number
          id?: string
          league_id?: string
          position?: string
          pss?: number
          rank?: number
          team_id?: string
          updated_at?: string
          z_score?: number
        }
        Relationships: [
          {
            foreignKeyName: "team_positional_strengths_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "connected_leagues"
            referencedColumns: ["id"]
          },
        ]
      }
      team_schedules: {
        Row: {
          created_at: string
          id: string
          is_home: boolean
          opponent: string
          season: number
          team: string
          updated_at: string
          week: number
        }
        Insert: {
          created_at?: string
          id?: string
          is_home?: boolean
          opponent: string
          season?: number
          team: string
          updated_at?: string
          week: number
        }
        Update: {
          created_at?: string
          id?: string
          is_home?: boolean
          opponent?: string
          season?: number
          team?: string
          updated_at?: string
          week?: number
        }
        Relationships: []
      }
      team_sos: {
        Row: {
          created_at: string | null
          id: string
          playoff_avg_def_rank: number | null
          playoff_sos_rank: number | null
          position: string
          ros_avg_def_rank: number | null
          ros_sos_rank: number | null
          season: number
          team: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          playoff_avg_def_rank?: number | null
          playoff_sos_rank?: number | null
          position: string
          ros_avg_def_rank?: number | null
          ros_sos_rank?: number | null
          season?: number
          team: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          playoff_avg_def_rank?: number | null
          playoff_sos_rank?: number | null
          position?: string
          ros_avg_def_rank?: number | null
          ros_sos_rank?: number | null
          season?: number
          team?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      team_strategies: {
        Row: {
          created_at: string | null
          id: string
          league_id: string
          losses: number | null
          must_win_mode: boolean | null
          playoff_odds: number | null
          playoff_position: number | null
          qb_strength: number | null
          rb_strength: number | null
          risk_profile: Database["public"]["Enums"]["risk_profile"] | null
          te_strength: number | null
          team_id: string
          ties: number | null
          updated_at: string | null
          wins: number | null
          wr_strength: number | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          league_id: string
          losses?: number | null
          must_win_mode?: boolean | null
          playoff_odds?: number | null
          playoff_position?: number | null
          qb_strength?: number | null
          rb_strength?: number | null
          risk_profile?: Database["public"]["Enums"]["risk_profile"] | null
          te_strength?: number | null
          team_id: string
          ties?: number | null
          updated_at?: string | null
          wins?: number | null
          wr_strength?: number | null
        }
        Update: {
          created_at?: string | null
          id?: string
          league_id?: string
          losses?: number | null
          must_win_mode?: boolean | null
          playoff_odds?: number | null
          playoff_position?: number | null
          qb_strength?: number | null
          rb_strength?: number | null
          risk_profile?: Database["public"]["Enums"]["risk_profile"] | null
          te_strength?: number | null
          team_id?: string
          ties?: number | null
          updated_at?: string | null
          wins?: number | null
          wr_strength?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "team_strategies_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "connected_leagues"
            referencedColumns: ["id"]
          },
        ]
      }
      token_packages: {
        Row: {
          bonus_percentage: number
          created_at: string
          display_order: number
          id: string
          is_active: boolean
          name: string
          price_cents: number
          stripe_price_id: string | null
          tokens: number
          updated_at: string
        }
        Insert: {
          bonus_percentage?: number
          created_at?: string
          display_order?: number
          id?: string
          is_active?: boolean
          name: string
          price_cents: number
          stripe_price_id?: string | null
          tokens: number
          updated_at?: string
        }
        Update: {
          bonus_percentage?: number
          created_at?: string
          display_order?: number
          id?: string
          is_active?: boolean
          name?: string
          price_cents?: number
          stripe_price_id?: string | null
          tokens?: number
          updated_at?: string
        }
        Relationships: []
      }
      token_transactions: {
        Row: {
          amount: number
          balance_after: number
          created_at: string
          description: string | null
          id: string
          metadata: Json | null
          transaction_type: Database["public"]["Enums"]["token_transaction_type"]
          user_id: string
        }
        Insert: {
          amount: number
          balance_after: number
          created_at?: string
          description?: string | null
          id?: string
          metadata?: Json | null
          transaction_type: Database["public"]["Enums"]["token_transaction_type"]
          user_id: string
        }
        Update: {
          amount?: number
          balance_after?: number
          created_at?: string
          description?: string | null
          id?: string
          metadata?: Json | null
          transaction_type?: Database["public"]["Enums"]["token_transaction_type"]
          user_id?: string
        }
        Relationships: []
      }
      trade_evaluations: {
        Row: {
          best_player_bonus_applied: boolean | null
          confidence: number
          created_at: string | null
          grade: string
          id: string
          key_factors: Json | null
          league_id: string
          my_players: Json
          my_team_id: string
          next_3_weeks_delta: number
          ros_points_delta: number
          summary: string | null
          their_players: Json
          their_team_id: string
          user_id: string
          verdict: string
        }
        Insert: {
          best_player_bonus_applied?: boolean | null
          confidence: number
          created_at?: string | null
          grade: string
          id?: string
          key_factors?: Json | null
          league_id: string
          my_players: Json
          my_team_id: string
          next_3_weeks_delta: number
          ros_points_delta: number
          summary?: string | null
          their_players: Json
          their_team_id: string
          user_id: string
          verdict: string
        }
        Update: {
          best_player_bonus_applied?: boolean | null
          confidence?: number
          created_at?: string | null
          grade?: string
          id?: string
          key_factors?: Json | null
          league_id?: string
          my_players?: Json
          my_team_id?: string
          next_3_weeks_delta?: number
          ros_points_delta?: number
          summary?: string | null
          their_players?: Json
          their_team_id?: string
          user_id?: string
          verdict?: string
        }
        Relationships: [
          {
            foreignKeyName: "trade_evaluations_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "connected_leagues"
            referencedColumns: ["id"]
          },
        ]
      }
      trade_values: {
        Row: {
          bye_week: number | null
          fetched_at: string
          id: number
          player_id_hint: string | null
          player_name: string
          position: string
          rank: number | null
          raw_hash: string
          snapshot_date: string
          source: string
          team: string | null
          tier: number | null
          value_score: number | null
        }
        Insert: {
          bye_week?: number | null
          fetched_at?: string
          id?: number
          player_id_hint?: string | null
          player_name: string
          position: string
          rank?: number | null
          raw_hash: string
          snapshot_date: string
          source: string
          team?: string | null
          tier?: number | null
          value_score?: number | null
        }
        Update: {
          bye_week?: number | null
          fetched_at?: string
          id?: number
          player_id_hint?: string | null
          player_name?: string
          position?: string
          rank?: number | null
          raw_hash?: string
          snapshot_date?: string
          source?: string
          team?: string | null
          tier?: number | null
          value_score?: number | null
        }
        Relationships: []
      }
      trade_values_dlq: {
        Row: {
          attempted_at: string
          error_message: string | null
          id: number
          raw_text: string
        }
        Insert: {
          attempted_at?: string
          error_message?: string | null
          id?: number
          raw_text: string
        }
        Update: {
          attempted_at?: string
          error_message?: string | null
          id?: number
          raw_text?: string
        }
        Relationships: []
      }
      user_identities: {
        Row: {
          created_at: string | null
          email: string | null
          id: string
          phone: string | null
          provider: string
          provider_uid: string
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          email?: string | null
          id?: string
          phone?: string | null
          provider: string
          provider_uid: string
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          email?: string | null
          id?: string
          phone?: string | null
          provider?: string
          provider_uid?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_identities_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string | null
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      user_teams: {
        Row: {
          created_at: string | null
          id: string
          league_id: string
          losses: number | null
          roster: Json
          team_id: string
          team_name: string
          ties: number | null
          total_projected: number | null
          updated_at: string | null
          wins: number | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          league_id: string
          losses?: number | null
          roster: Json
          team_id: string
          team_name: string
          ties?: number | null
          total_projected?: number | null
          updated_at?: string | null
          wins?: number | null
        }
        Update: {
          created_at?: string | null
          id?: string
          league_id?: string
          losses?: number | null
          roster?: Json
          team_id?: string
          team_name?: string
          ties?: number | null
          total_projected?: number | null
          updated_at?: string | null
          wins?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "user_teams_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "connected_leagues"
            referencedColumns: ["id"]
          },
        ]
      }
      user_tokens: {
        Row: {
          balance: number
          created_at: string
          has_unlimited_subscription: boolean
          id: string
          last_weekly_reward_at: string | null
          lifetime_earned: number
          lifetime_purchased: number
          lifetime_spent: number
          rankings_expires_at: string | null
          rankings_unlocked_at: string | null
          rankings_unlocked_week: number | null
          subscription_expires_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          balance?: number
          created_at?: string
          has_unlimited_subscription?: boolean
          id?: string
          last_weekly_reward_at?: string | null
          lifetime_earned?: number
          lifetime_purchased?: number
          lifetime_spent?: number
          rankings_expires_at?: string | null
          rankings_unlocked_at?: string | null
          rankings_unlocked_week?: number | null
          subscription_expires_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          balance?: number
          created_at?: string
          has_unlimited_subscription?: boolean
          id?: string
          last_weekly_reward_at?: string | null
          lifetime_earned?: number
          lifetime_purchased?: number
          lifetime_spent?: number
          rankings_expires_at?: string | null
          rankings_unlocked_at?: string | null
          rankings_unlocked_week?: number | null
          subscription_expires_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      waiver_wire_players: {
        Row: {
          applied_breakdown: Json | null
          confidence: number | null
          created_at: string | null
          espn_league_id: string
          id: string
          last_updated: string | null
          league_id: string
          percent_owned: number | null
          percent_started: number | null
          player_id: string
          player_name: string
          position: string
          projected_fp: number | null
          provider_ids: Json | null
          season: number
          source: string | null
          stats: Json | null
          status_flags: Json | null
          team: string | null
          updated_at: string | null
          waiver_status: string
          week: number
        }
        Insert: {
          applied_breakdown?: Json | null
          confidence?: number | null
          created_at?: string | null
          espn_league_id: string
          id?: string
          last_updated?: string | null
          league_id: string
          percent_owned?: number | null
          percent_started?: number | null
          player_id: string
          player_name: string
          position: string
          projected_fp?: number | null
          provider_ids?: Json | null
          season: number
          source?: string | null
          stats?: Json | null
          status_flags?: Json | null
          team?: string | null
          updated_at?: string | null
          waiver_status?: string
          week: number
        }
        Update: {
          applied_breakdown?: Json | null
          confidence?: number | null
          created_at?: string | null
          espn_league_id?: string
          id?: string
          last_updated?: string | null
          league_id?: string
          percent_owned?: number | null
          percent_started?: number | null
          player_id?: string
          player_name?: string
          position?: string
          projected_fp?: number | null
          provider_ids?: Json | null
          season?: number
          source?: string | null
          stats?: Json | null
          status_flags?: Json | null
          team?: string | null
          updated_at?: string | null
          waiver_status?: string
          week?: number
        }
        Relationships: []
      }
      weekly_props: {
        Row: {
          actual_value: number | null
          created_at: string
          game_time: string | null
          id: string
          line: number
          opponent: string | null
          over_multiplier: number
          player_id: string
          player_name: string
          season: number
          settled_at: string | null
          stat_type: Database["public"]["Enums"]["prop_stat_type"]
          status: Database["public"]["Enums"]["prop_status"]
          team: string
          under_multiplier: number
          updated_at: string
          week: number
        }
        Insert: {
          actual_value?: number | null
          created_at?: string
          game_time?: string | null
          id?: string
          line: number
          opponent?: string | null
          over_multiplier?: number
          player_id: string
          player_name: string
          season: number
          settled_at?: string | null
          stat_type: Database["public"]["Enums"]["prop_stat_type"]
          status?: Database["public"]["Enums"]["prop_status"]
          team: string
          under_multiplier?: number
          updated_at?: string
          week: number
        }
        Update: {
          actual_value?: number | null
          created_at?: string
          game_time?: string | null
          id?: string
          line?: number
          opponent?: string | null
          over_multiplier?: number
          player_id?: string
          player_name?: string
          season?: number
          settled_at?: string | null
          stat_type?: Database["public"]["Enums"]["prop_stat_type"]
          status?: Database["public"]["Enums"]["prop_status"]
          team?: string
          under_multiplier?: number
          updated_at?: string
          week?: number
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      check_rate_limit: {
        Args: {
          p_endpoint: string
          p_max_requests: number
          p_user_id: string
          p_window_minutes: number
        }
        Returns: Json
      }
      cleanup_old_rate_limits: { Args: never; Returns: undefined }
      cleanup_old_risk_events: { Args: never; Returns: undefined }
      deduct_tokens: {
        Args: {
          p_amount: number
          p_description?: string
          p_transaction_type: Database["public"]["Enums"]["token_transaction_type"]
          p_user_id: string
        }
        Returns: Json
      }
      get_league_credentials: {
        Args: { p_league_id: string; p_platform: string; p_user_id: string }
        Returns: Json
      }
      get_oauth_token: {
        Args: { p_league_id: string; p_platform: string; p_user_id: string }
        Returns: Json
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      normalize_email: { Args: { raw_email: string }; Returns: string }
      settle_weekly_prop: {
        Args: { p_actual_value: number; p_prop_id: string }
        Returns: undefined
      }
      store_league_credentials: {
        Args: {
          p_credentials: Json
          p_league_id: string
          p_platform: string
          p_user_id: string
        }
        Returns: string
      }
      store_oauth_token: {
        Args: {
          p_league_id: string
          p_platform: string
          p_token_data: Json
          p_user_id: string
        }
        Returns: undefined
      }
    }
    Enums: {
      app_role: "admin" | "moderator" | "user"
      league_platform: "espn" | "yahoo" | "sleeper"
      player_position: "QB" | "RB" | "WR" | "TE" | "K" | "DEF"
      prop_stat_type:
        | "passing_yards"
        | "rushing_yards"
        | "receiving_yards"
        | "touchdowns"
        | "receptions"
        | "fantasy_points"
      prop_status:
        | "pending"
        | "active"
        | "settled_won"
        | "settled_lost"
        | "cancelled"
      risk_profile: "aggressive" | "balanced" | "conservative"
      scoring_type: "standard" | "ppr" | "half_ppr" | "custom"
      token_transaction_type:
        | "purchase"
        | "signup_bonus"
        | "weekly_reward"
        | "ai_assistant"
        | "start_sit"
        | "trade_analysis"
        | "prop_bet"
        | "prop_win"
        | "admin_adjustment"
        | "subscription"
        | "ranking_unlock"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "moderator", "user"],
      league_platform: ["espn", "yahoo", "sleeper"],
      player_position: ["QB", "RB", "WR", "TE", "K", "DEF"],
      prop_stat_type: [
        "passing_yards",
        "rushing_yards",
        "receiving_yards",
        "touchdowns",
        "receptions",
        "fantasy_points",
      ],
      prop_status: [
        "pending",
        "active",
        "settled_won",
        "settled_lost",
        "cancelled",
      ],
      risk_profile: ["aggressive", "balanced", "conservative"],
      scoring_type: ["standard", "ppr", "half_ppr", "custom"],
      token_transaction_type: [
        "purchase",
        "signup_bonus",
        "weekly_reward",
        "ai_assistant",
        "start_sit",
        "trade_analysis",
        "prop_bet",
        "prop_win",
        "admin_adjustment",
        "subscription",
        "ranking_unlock",
      ],
    },
  },
} as const
