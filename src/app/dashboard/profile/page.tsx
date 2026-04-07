import { getAffiliateContext } from "@/lib/affiliate-context";
import { fmt } from "@/lib/fmt";
import TierBadge from "@/components/ui/TierBadge";
import UpdatePasswordForm from "@/components/dashboard/UpdatePasswordForm";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const ctx = await getAffiliateContext();
  if (!ctx) return null;
  const { affiliate } = ctx;

  return (
    <>
      <div className="animate-reveal-up">
        <h1 className="text-2xl font-bold text-gray-900">Profile</h1>
        <p className="text-sm text-brand-400 mt-1">
          Your account details and settings.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Account info */}
        <div className="card p-6 flex flex-col gap-5">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="text-sm font-semibold text-gray-900">Account Information</h3>
              <p className="text-xs text-brand-400 mt-0.5">Your affiliate account details</p>
            </div>
            <TierBadge tier={affiliate.tier} size="md" />
          </div>

          <div className="space-y-4">
            <InfoRow label="Name" value={affiliate.agent_name} />
            <InfoRow label="Email" value={affiliate.email} />
            {affiliate.business_name && (
              <InfoRow label="Business" value={affiliate.business_name} />
            )}
            {affiliate.phone && (
              <InfoRow label="Phone" value={affiliate.phone} />
            )}
            <InfoRow label="Tier" value={affiliate.tier.charAt(0).toUpperCase() + affiliate.tier.slice(1)} />
            <InfoRow
              label="Total Volume"
              value={fmt.currency(affiliate.referred_volume_total)}
            />
            <InfoRow label="Member Since" value={fmt.date(affiliate.created_at)} />
            <InfoRow
              label="Last Login"
              value={affiliate.last_login_at ? fmt.relative(affiliate.last_login_at) : "Never"}
            />
            <InfoRow
              label="Attribution ID"
              value={affiliate.attribution_id}
              mono
            />
          </div>
        </div>

        {/* Password section */}
        <div className="card p-6 flex flex-col gap-5">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Update Password</h3>
            <p className="text-xs text-brand-400 mt-0.5">
              {affiliate.has_password
                ? "Change your current password"
                : "Set a password to log in with email + password"}
            </p>
          </div>

          <UpdatePasswordForm />
        </div>
      </div>
    </>
  );
}

function InfoRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2 border-b border-surface-200/60 last:border-0">
      <p className="text-xs text-brand-400 uppercase tracking-wider font-medium flex-shrink-0">
        {label}
      </p>
      <p
        className={`text-sm text-gray-900 text-right truncate ${
          mono ? "font-mono text-xs" : ""
        }`}
      >
        {value}
      </p>
    </div>
  );
}
