// ============================================================
// Wallet Affiliate Dashboard — Type Definitions
// ============================================================

// --- Enums (string unions) ---

export type FunnelStatusSlug =
  | 'waitlist'
  | 'booked_call'
  | 'sent_onboarding'
  | 'signed_up'
  | 'transaction_run'
  | 'funds_in_wallet'
  | 'ach_initiated'
  | 'funds_in_bank';

export type AffiliateStatus = 'active' | 'suspended' | 'pending' | 'archived';

export type AffiliateTier = 'gold' | 'platinum' | 'custom';

export type EarningStatus = 'pending' | 'approved' | 'paid' | 'reversed';

export type PayoutProvider = 'stripe_connect' | 'manual' | 'mercury';

export type PayoutAccountStatus = 'pending' | 'active' | 'disconnected';

export type PayoutStatus =
  | 'pending_review'
  | 'requested'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'rejected';

export type NotificationType =
  | 'funnel_change'
  | 'earning_credited'
  | 'tier_upgrade'
  | 'payout_processed'
  | 'system_announcement';

// --- Interfaces ---

export interface Affiliate {
  id: string;
  user_id: string;
  agent_name: string;
  business_name: string | null;
  email: string;
  phone: string | null;
  tier: AffiliateTier;
  tier_override: boolean;
  status: AffiliateStatus;
  referred_volume_total: number;
  /** Manual volume credit (e.g. legacy-business referrals not tied to a tracked
   *  transaction). Added to the synced Transfer-In total to form
   *  referred_volume_total. Set by admin, never by sync. */
  legacy_volume_adjustment: number;
  attribution_id: string;
  has_password: boolean;
  agreement_status: string | null;
  bank_details_needed: boolean;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
  whitelabel_brand_id: string | null;
  custom_commission_rate: number | null;
  custom_commission_basis: 'tpv' | 'kashu_fee' | null;
  airtable_created_at: string | null;
  agreement_completed_at: string | null;
  pandadoc_id: string | null;
}

export interface ReferredUser {
  id: string;
  affiliate_id: string;
  full_name: string;
  email: string;
  phone: string | null;
  status_slug: FunnelStatusSlug;
  first_transaction_amount: number | null;
  first_transaction_fee: number | null;
  first_transaction_at: string | null;
  wallet_user_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface FunnelStatus {
  id: string;
  slug: FunnelStatusSlug;
  label: string;
  color: string;
  sort_order: number;
}

export interface FunnelEvent {
  id: string;
  referred_user_id: string;
  from_status: FunnelStatusSlug | null;
  to_status: FunnelStatusSlug;
  created_at: string;
}

export interface Earning {
  id: string;
  affiliate_id: string;
  referred_user_id: string;
  amount: number;
  transaction_fee_amount: number;
  tier_at_earning: AffiliateTier;
  transaction_ref: string | null;
  status: EarningStatus;
  created_at: string;
  updated_at: string;
  custom_commission_rate: number | null;
  custom_commission_basis: 'tpv' | 'kashu_fee' | null;
  payout_id: string | null;
}

export interface StageDuration {
  status_slug: string;
  avg_hours: number;
}

export interface Notification {
  id: string;
  affiliate_id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  is_read: boolean;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface LeaderboardSnapshot {
  id: string;
  period: string;
  affiliate_id: string;
  rank: number;
  referred_user_count: number;
  referred_volume: number;
  total_earnings: number;
  conversion_rate: number;
  percentile: number;
  created_at: string;
}

export interface Payout {
  id: string;
  affiliate_id: string;
  payout_account_id: string | null;
  amount: number;
  currency: string;
  status: PayoutStatus;
  provider_reference_id: string | null;
  period: string | null;
  created_at: string;
  updated_at: string;
  batch_id: string | null;
  submitted_by: string | null;
  submitted_at: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
}

export interface PayoutAccount {
  id: string;
  affiliate_id: string;
  provider: PayoutProvider;
  provider_id: string | null;
  account_name: string | null;
  routing_number: string | null;
  account_number_last4: string | null;
  is_default: boolean;
  is_verified: boolean;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  address1: string | null;
  address2: string | null;
  city: string | null;
  region: string | null;
  postal_code: string | null;
  country: string | null;
}

export interface PayoutSettings {
  id: string;
  min_payout_amount: number;
  default_provider: PayoutProvider;
  auto_approve_earnings: boolean;
  max_single_payout: number;
  max_daily_aggregate: number;
  max_batch_size: number;
  created_at: string;
  updated_at: string;
}

export interface PayoutAuditLog {
  id: string;
  payout_id: string | null;
  affiliate_id: string | null;
  action: string;
  amount: number | null;
  mercury_transaction_id: string | null;
  mercury_status: string | null;
  request_payload: Record<string, unknown> | null;
  response_payload: Record<string, unknown> | null;
  error_message: string | null;
  initiated_by: string | null;
  created_at: string;
}

export interface PendingBankDetails {
  id: string;
  email: string;
  document_id: string | null;
  document_name: string | null;
  account_holder_name: string | null;
  routing_number: string | null;
  account_number: string | null;
  account_type: string | null;
  processed: boolean;
  processed_at: string | null;
  error_message: string | null;
  created_at: string;
}

export interface Admin {
  id: string;
  user_id: string;
  email: string;
  role: string;
  has_password: boolean;
  last_login_at: string | null;
  created_at: string;
}

export interface SecurityAuditLog {
  id: string;
  user_id: string | null;
  user_email: string | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  ip_address: string | null;
  user_agent: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface WebhookEvent {
  id: string;
  idempotency_key: string;
  event_type: string;
  payload: Record<string, unknown>;
  processed: boolean;
  error_message: string | null;
  created_at: string;
  processed_at: string | null;
}

export interface WhitelabelBrand {
  id:              string;
  slug:            string;
  display_name:    string;
  logo_path:       string;
  sidebar_bg_hex:  string;
  sidebar_fg_hex:  string;
  accent_hex:      string;
  signup_base_url: string | null;
  created_at:      string;
  updated_at:      string;
}

export interface Transaction {
  id: string;
  referred_user_id: string | null;
  affiliate_id: string | null;
  airtable_record_id: string;
  amount: number;
  transaction_type: string;
  transaction_external_id: string | null;
  transaction_date: string | null;
  email: string | null;
  self_referral: boolean;
  created_at: string;
  updated_at: string;
}

// --- Supabase Row/Insert/Update helpers ---

type WithOptionalId<T> = Omit<T, 'id' | 'created_at' | 'updated_at'> & {
  id?: string;
  created_at?: string;
  updated_at?: string;
};

type UpdatableFields<T> = Partial<Omit<T, 'id' | 'created_at'>>;

// --- Database interface for Supabase client typing ---

export interface Database {
  public: {
    Tables: {
      affiliates: {
        Row: Affiliate;
        Insert: WithOptionalId<Affiliate>;
        Update: UpdatableFields<Affiliate>;
      };
      referred_users: {
        Row: ReferredUser;
        Insert: WithOptionalId<ReferredUser>;
        Update: UpdatableFields<ReferredUser>;
      };
      funnel_statuses: {
        Row: FunnelStatus;
        Insert: WithOptionalId<FunnelStatus>;
        Update: UpdatableFields<FunnelStatus>;
      };
      funnel_events: {
        Row: FunnelEvent;
        Insert: WithOptionalId<FunnelEvent>;
        Update: UpdatableFields<FunnelEvent>;
      };
      earnings: {
        Row: Earning;
        Insert: WithOptionalId<Earning>;
        Update: UpdatableFields<Earning>;
      };
      notifications: {
        Row: Notification;
        Insert: WithOptionalId<Notification>;
        Update: UpdatableFields<Notification>;
      };
      leaderboard_snapshots: {
        Row: LeaderboardSnapshot;
        Insert: WithOptionalId<LeaderboardSnapshot>;
        Update: UpdatableFields<LeaderboardSnapshot>;
      };
      payouts: {
        Row: Payout;
        Insert: WithOptionalId<Payout>;
        Update: UpdatableFields<Payout>;
      };
      payout_accounts: {
        Row: PayoutAccount;
        Insert: WithOptionalId<PayoutAccount>;
        Update: UpdatableFields<PayoutAccount>;
      };
      payout_settings: {
        Row: PayoutSettings;
        Insert: WithOptionalId<PayoutSettings>;
        Update: UpdatableFields<PayoutSettings>;
      };
      payout_audit_log: {
        Row: PayoutAuditLog;
        Insert: WithOptionalId<PayoutAuditLog>;
        Update: UpdatableFields<PayoutAuditLog>;
      };
      pending_bank_details: {
        Row: PendingBankDetails;
        Insert: WithOptionalId<PendingBankDetails>;
        Update: UpdatableFields<PendingBankDetails>;
      };
      admins: {
        Row: Admin;
        Insert: WithOptionalId<Admin>;
        Update: UpdatableFields<Admin>;
      };
      security_audit_logs: {
        Row: SecurityAuditLog;
        Insert: WithOptionalId<SecurityAuditLog>;
        Update: UpdatableFields<SecurityAuditLog>;
      };
      webhook_events: {
        Row: WebhookEvent;
        Insert: WithOptionalId<WebhookEvent>;
        Update: UpdatableFields<WebhookEvent>;
      };
      transactions: {
        Row: Transaction;
        Insert: WithOptionalId<Transaction>;
        Update: UpdatableFields<Transaction>;
      };
    };
    Functions: {
      get_my_affiliate_id: {
        Args: Record<string, never>;
        Returns: string;
      };
      request_payout: {
        Args: {
          p_affiliate_id: string;
          p_amount: number;
        };
        Returns: string;
      };
    };
  };
}

// --- Affiliate /tools tab ---

export interface AffiliateResource {
  id: string;
  title: string;
  description: string | null;
  kind: "video" | "pdf" | "image" | "archive";
  category: "onboarding" | "tutorial" | "brand" | "compliance" | "guide";
  storage_path: string;
  public_url: string;
  thumbnail_path: string | null;
  file_size_bytes: number | null;
  duration_seconds: number | null;
  sort_order: number;
  is_published: boolean;
  created_at: string;
  updated_at: string;
}

export interface ShareTemplate {
  id: string;
  title: string;
  platform: "instagram" | "twitter" | "linkedin" | "general";
  category: "intro" | "case-study" | "promo" | "follow-up";
  body: string;
  sort_order: number;
  is_published: boolean;
  created_at: string;
  updated_at: string;
}
