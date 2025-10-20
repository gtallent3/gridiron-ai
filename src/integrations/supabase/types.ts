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
      player_valuations: {
        Row: {
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_league_credentials: {
        Args: { p_league_id: string; p_platform: string; p_user_id: string }
        Returns: Json
      }
      get_oauth_token: {
        Args: { p_league_id: string; p_platform: string; p_user_id: string }
        Returns: Json
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
      league_platform: "espn" | "yahoo" | "sleeper"
      player_position: "QB" | "RB" | "WR" | "TE" | "K" | "DEF"
      risk_profile: "aggressive" | "balanced" | "conservative"
      scoring_type: "standard" | "ppr" | "half_ppr" | "custom"
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
      league_platform: ["espn", "yahoo", "sleeper"],
      player_position: ["QB", "RB", "WR", "TE", "K", "DEF"],
      risk_profile: ["aggressive", "balanced", "conservative"],
      scoring_type: ["standard", "ppr", "half_ppr", "custom"],
    },
  },
} as const
