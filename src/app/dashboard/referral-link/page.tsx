import { getAffiliateContext } from "@/lib/affiliate-context";
import ReferralLinkCard from "@/components/dashboard/ReferralLinkCard";
import QRCodeGenerator from "@/components/dashboard/QRCodeGenerator";

export const dynamic = "force-dynamic";

export default async function ReferralLinkPage() {
  const ctx = await getAffiliateContext();
  if (!ctx) return null;
  const { affiliate } = ctx;

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "";
  const referralUrl = `https://app.kashupay.com?promo=${affiliate.attribution_id}`;

  return (
    <>
      <div className="animate-reveal-up">
        <h1 className="text-2xl font-bold text-gray-900">Referral Link</h1>
        <p className="text-sm text-brand-400 mt-1">
          Share your unique referral link to earn commissions on every transaction.
        </p>
      </div>

      <ReferralLinkCard
        url={referralUrl}
        description="Share this link to earn commissions on every transaction your users complete."
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <QRCodeGenerator referralUrl={referralUrl} />

        {/* Usage tips */}
        <div className="card p-6 flex flex-col gap-5">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">How It Works</h3>
            <p className="text-xs text-brand-400 mt-0.5">
              Tips for maximizing your referrals
            </p>
          </div>

          <div className="space-y-4">
            {[
              {
                title: "Share your link",
                desc: "Send your unique referral URL to potential users via email, social media, or messaging apps.",
                icon: (
                  <svg className="w-4 h-4 text-accent" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
                  </svg>
                ),
              },
              {
                title: "Users sign up",
                desc: "When someone clicks your link and creates a Kashu Wallet account, they are attributed to you.",
                icon: (
                  <svg className="w-4 h-4 text-accent" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M18 7.5v3m0 0v3m0-3h3m-3 0h-3m-2.25-4.125a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zM3 19.235v-.11a6.375 6.375 0 0112.75 0v.109A12.318 12.318 0 019.374 21c-2.331 0-4.512-.645-6.374-1.766z" />
                  </svg>
                ),
              },
              {
                title: "Earn commissions",
                desc: "Gold and Platinum tier partners earn a commission on the first transaction each referred user completes.",
                icon: (
                  <svg className="w-4 h-4 text-accent" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                ),
              },
              {
                title: "Use the QR code",
                desc: "Download your QR code for in-person conversations, printed materials, or presentations.",
                icon: (
                  <svg className="w-4 h-4 text-accent" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 013.75 9.375v-4.5zM3.75 14.625c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 01-1.125-1.125v-4.5zM13.5 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0113.5 9.375v-4.5z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 6.75h.75v.75h-.75v-.75zM6.75 16.5h.75v.75h-.75v-.75zM16.5 6.75h.75v.75h-.75v-.75zM13.5 13.5h.75v.75h-.75v-.75zM13.5 19.5h.75v.75h-.75v-.75zM19.5 13.5h.75v.75h-.75v-.75zM19.5 19.5h.75v.75h-.75v-.75zM16.5 16.5h.75v.75h-.75v-.75z" />
                  </svg>
                ),
              },
            ].map((tip) => (
              <div key={tip.title} className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-xl bg-accent/10 border border-accent/15 flex items-center justify-center flex-shrink-0">
                  {tip.icon}
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-900">{tip.title}</p>
                  <p className="text-xs text-brand-400 mt-0.5 leading-relaxed">{tip.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
