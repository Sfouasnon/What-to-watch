export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

type Relationship = {
  foreignKeyName: string;
  columns: string[];
  isOneToOne?: boolean;
  referencedRelation: string;
  referencedColumns: string[];
};

type Table<Row, Insert = Partial<Row>, Update = Partial<Insert>> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: Relationship[];
};

export type FriendShareMode = "ratings_and_reviews" | "ratings_only" | "nothing";
export type FriendshipStatus = "pending" | "accepted" | "declined";

export type Profile = {
  id: string;
  account_id: string;
  display_name: string;
  avatar_key: string | null;
  avatar_url: string | null;
  is_guest: boolean;
  onboarding_completed: boolean;
  region: string;
  cloned_from_profile_id: string | null;
  current_model_version_id: string | null;
  share_with_friends: FriendShareMode;
  created_at: string;
  updated_at: string;
};

export type Title = {
  id: string;
  tmdb_id: number | null;
  tmdb_media_type: "movie" | "tv" | null;
  content_type: "movie" | "tv_series" | "standup_special";
  name: string;
  original_name: string | null;
  overview: string | null;
  release_date: string | null;
  end_date: string | null;
  runtime_minutes: number | null;
  episode_runtime_minutes: number | null;
  season_count: number | null;
  episode_count: number | null;
  original_language: string | null;
  production_countries: string[];
  poster_path: string | null;
  backdrop_path: string | null;
  popularity: number | null;
  vote_average: number | null;
  vote_count: number | null;
  canonical_score: number;
  external_ids: Json;
  metadata_source: string;
  metadata_checked_at: string | null;
  created_at: string;
  updated_at: string;
};

export type CreditDepartment =
  | "acting"
  | "directing"
  | "writing"
  | "cinematography"
  | "production"
  | "other";

export type Person = {
  id: string;
  tmdb_id: number | null;
  name: string;
  biography: string | null;
  profile_path: string | null;
  external_ids: Json;
  metadata_checked_at: string | null;
  created_at: string;
  updated_at: string;
};

export type TitleCredit = {
  id: string;
  title_id: string;
  person_id: string;
  department: CreditDepartment;
  job: string | null;
  character_name: string | null;
  billing_order: number | null;
  credited: boolean;
};

export type Friendship = {
  id: string;
  requester_profile_id: string;
  addressee_profile_id: string;
  status: FriendshipStatus;
  created_at: string;
  responded_at: string | null;
};

export type FriendReviewNote = {
  id: string;
  author_profile_id: string;
  title_id: string;
  note: string;
  created_at: string;
  updated_at: string;
};

export type FriendRecommendation = {
  id: string;
  sender_profile_id: string;
  recipient_profile_id: string;
  title_id: string;
  note: string | null;
  created_at: string;
};

export type Database = {
  public: {
    Tables: {
      profiles: Table<
        Profile,
        Pick<Profile, "account_id" | "display_name"> & Partial<Omit<Profile, "account_id" | "display_name">>
      >;
      profile_settings: Table<{
        profile_id: string;
        rental_policy: "never" | "exceptional" | "always";
        allow_free_with_ads: boolean;
        allow_purchase_only: boolean;
        max_runtime_minutes: number | null;
        excluded_content_tags: string[];
        created_at: string;
        updated_at: string;
      }>;
      streaming_services: Table<{
        id: string;
        slug: string;
        display_name: string;
        tmdb_provider_id: number | null;
        logo_path: string | null;
        website_url: string | null;
        active: boolean;
        sort_order: number;
        created_at: string;
        updated_at: string;
      }>;
      profile_streaming_services: Table<{
        profile_id: string;
        service_id: string;
        subscribed_at: string;
      }>;
      titles: Table<Title>;
      people: Table<Person, Pick<Person, "name"> & Partial<Omit<Person, "name">>>;
      title_credits: Table<
        TitleCredit,
        Pick<TitleCredit, "title_id" | "person_id" | "department"> &
          Partial<Omit<TitleCredit, "title_id" | "person_id" | "department">>
      >;
      ratings: Table<{
        id: string;
        profile_id: string;
        title_id: string;
        score: number;
        watched_state: "watched" | "partially_watched" | "abandoned";
        rewatch_count: number;
        source_context: string | null;
        rated_at: string;
        created_at: string;
        updated_at: string;
      }>;
      watch_history: Table<{
        id: string;
        profile_id: string;
        title_id: string;
        watched_at: string;
        completion_percent: number | null;
        season_number: number | null;
        episode_number: number | null;
        source_context: string | null;
        created_at: string;
      }>;
      recommendation_feedback: Table<{
        id: string;
        profile_id: string;
        recommendation_item_id: string;
        recommendation_score: number | null;
        quick_feedback: string[];
        notes: string | null;
        created_at: string;
        updated_at: string;
      }>;
      friendships: Table<Friendship>;
      friend_review_notes: Table<FriendReviewNote>;
      friend_recommendations: Table<FriendRecommendation>;
      friend_taste_compatibilities: Table<{
        profile_low_id: string;
        profile_high_id: string;
        overlap_count: number;
        compatibility: number;
        calculated_at: string;
      }>;
      model_configs: Table<{
        id: string;
        profile_id: string;
        name: string;
        schema_version: number;
        configuration: Json;
        source: "default" | "local_learning" | "external_import" | "manual" | "rollback";
        parent_config_id: string | null;
        configuration_sha256: string | null;
        created_at: string;
      }>;
      model_versions: Table<{
        id: string;
        profile_id: string;
        config_id: string;
        version_number: number;
        status: "active" | "superseded" | "rolled_back";
        notes: string | null;
        activated_at: string;
        ended_at: string | null;
        created_at: string;
      }>;
    };
    Views: Record<never, never>;
    Functions: {
      clone_profile_settings: {
        Args: {
          source_profile_id: string;
          new_display_name: string;
          new_avatar_key?: string | null;
          create_as_guest?: boolean;
        };
        Returns: Profile;
      };
      import_model_configuration: {
        Args: {
          target_profile_id: string;
          config_name: string;
          config_schema_version: number;
          new_configuration: Json;
          expected_sha256?: string | null;
        };
        Returns: Database["public"]["Tables"]["model_versions"]["Row"];
      };
      owns_profile: { Args: { target_profile_id: string }; Returns: boolean };
      are_friends: {
        Args: { first_profile_id: string; second_profile_id: string };
        Returns: boolean;
      };
      can_view_social_profile: {
        Args: { target_profile_id: string };
        Returns: boolean;
      };
      request_friendship: {
        Args: { requester_profile_id: string; target_profile_id: string };
        Returns: Friendship;
      };
      respond_to_friendship: {
        Args: { target_friendship_id: string; accept_request: boolean };
        Returns: Friendship;
      };
      remove_friendship: {
        Args: { target_friendship_id: string };
        Returns: boolean;
      };
      search_friend_profiles: {
        Args: { viewer_profile_id: string; search_text: string };
        Returns: Array<{
          profile_id: string;
          display_name: string;
          avatar_key: string | null;
          avatar_url: string | null;
        }>;
      };
      get_friend_title_activity: {
        Args: { viewer_profile_id: string; target_title_id: string };
        Returns: Array<{
          friend_profile_id: string;
          friend_display_name: string;
          friend_avatar_key: string | null;
          friend_avatar_url: string | null;
          friend_rating: number | null;
          rating_at: string | null;
          review_note: string | null;
          explicitly_recommended: boolean;
          recommendation_note: string | null;
          recommendation_created_at: string | null;
        }>;
      };
      recalculate_friend_taste_compatibility: {
        Args: { first_profile_id: string; second_profile_id: string };
        Returns: number;
      };
    };
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
  };
};
