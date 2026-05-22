export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          display_name: string;
          display_name_lower: string;
          avatar_color: string;
          default_name_assigned: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          display_name: string;
          display_name_lower?: string;
          avatar_color?: string;
          default_name_assigned?: boolean;
        };
        Update: Partial<Database["public"]["Tables"]["profiles"]["Insert"]>;
        Relationships: [];
      };
      scene_catalog: {
        Row: {
          id: string;
          slug: string;
          title: string;
          module: string;
          description: string;
          thumbnail_url: string | null;
          snapshot: Json;
          sort_order: number;
          is_published: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          slug: string;
          title: string;
          module?: string;
          description?: string;
          thumbnail_url?: string | null;
          snapshot?: Json;
          sort_order?: number;
          is_published?: boolean;
        };
        Update: Partial<Database["public"]["Tables"]["scene_catalog"]["Insert"]>;
        Relationships: [];
      };
      user_scenes: {
        Row: {
          id: string;
          owner_id: string;
          title: string;
          module: string;
          snapshot: Json;
          is_public: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          title: string;
          module?: string;
          snapshot: Json;
          is_public?: boolean;
        };
        Update: Partial<Database["public"]["Tables"]["user_scenes"]["Insert"]>;
        Relationships: [];
      };
      rooms: {
        Row: {
          id: string;
          slug: string;
          title: string;
          module: string;
          is_public: boolean;
          visibility: string;
          join_code: string;
          owner_id: string | null;
          origin_catalog_id: string | null;
          origin_scene_id: string | null;
          archived_at: string | null;
          settings: Json;
          created_by: string | null;
          created_at: string;
          updated_at: string;
          scene_snapshot: Json;
          scene_revision: number;
          playback_state: string;
          playback_revision: number;
          object_limit: number;
          max_snapshot_bytes: number;
        };
        Insert: {
          id?: string;
          slug: string;
          title: string;
          module?: string;
          is_public?: boolean;
          visibility?: string;
          join_code?: string;
          owner_id?: string | null;
          created_by?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["rooms"]["Insert"]>;
        Relationships: [];
      };
      room_scene_ops: {
        Row: {
          id: string;
          room_id: string;
          seq: number;
          actor_id: string | null;
          base_revision: number;
          op: Json;
          client_op_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          room_id: string;
          seq: number;
          actor_id?: string | null;
          base_revision: number;
          op: Json;
          client_op_id?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["room_scene_ops"]["Insert"]>;
        Relationships: [];
      };
      room_members: {
        Row: {
          id: string;
          room_id: string;
          user_id: string | null;
          guest_id: string | null;
          role: string;
          display_name: string;
          joined_at: string;
          kicked_at: string | null;
          removed_by: string | null;
        };
        Insert: {
          id?: string;
          room_id: string;
          user_id?: string | null;
          guest_id?: string | null;
          role: string;
          display_name: string;
        };
        Update: Partial<Database["public"]["Tables"]["room_members"]["Insert"]>;
        Relationships: [];
      };
      room_messages: {
        Row: {
          id: string;
          room_id: string;
          user_id: string | null;
          guest_id: string | null;
          display_name: string;
          body: string;
          member_role: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          room_id: string;
          user_id?: string | null;
          guest_id?: string | null;
          display_name: string;
          body: string;
          member_role?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["room_messages"]["Insert"]>;
        Relationships: [];
      };
      room_annotations: {
        Row: {
          id: string;
          room_id: string;
          author_id: string | null;
          guest_id: string | null;
          author_name: string;
          kind: string;
          points: Json;
          label: string | null;
          persistent: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          room_id: string;
          guest_id?: string | null;
          author_name: string;
          kind: string;
          points?: Json;
          label?: string | null;
          persistent?: boolean;
        };
        Update: Partial<Database["public"]["Tables"]["room_annotations"]["Insert"]>;
        Relationships: [];
      };
      room_actions: {
        Row: {
          id: string;
          room_id: string;
          user_id: string | null;
          guest_id: string | null;
          display_name: string;
          summary: string;
          action_type: string;
          entity_id: string | null;
          tick: number | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          room_id: string;
          guest_id?: string | null;
          display_name: string;
          summary: string;
          action_type: string;
          entity_id?: string | null;
          tick?: number | null;
        };
        Update: Partial<Database["public"]["Tables"]["room_actions"]["Insert"]>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      update_display_name: {
        Args: { p_display_name: string };
        Returns: Database["public"]["Tables"]["profiles"]["Row"];
      };
      create_room: {
        Args: {
          p_title: string;
          p_module?: string;
          p_visibility?: string;
          p_catalog_id?: string | null;
          p_user_scene_id?: string | null;
        };
        Returns: Json;
      };
      join_room: {
        Args: {
          p_join_code: string;
          p_guest_id?: string;
          p_guest_display_name?: string;
          p_as_spectator?: boolean;
        };
        Returns: Json;
      };
      kick_room_member: {
        Args: { p_member_id: string };
        Returns: null;
      };
      get_room_scene: {
        Args: { p_room_id: string };
        Returns: Json;
      };
      apply_scene_op: {
        Args: {
          p_room_id: string;
          p_base_revision: number;
          p_op: Json;
          p_client_op_id?: string | null;
        };
        Returns: Json;
      };
      set_playback_state: {
        Args: { p_room_id: string; p_state: string; p_snapshot?: unknown };
        Returns: Json;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
