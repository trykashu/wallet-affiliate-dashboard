export const dynamic = "force-dynamic";

export default function SupportPage() {
  return (
    <>
      <div className="animate-reveal-up">
        <h1 className="text-2xl font-bold text-gray-900">Support</h1>
        <p className="text-sm text-brand-400 mt-1">
          Get help with your affiliate account and referrals.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Contact */}
        <div className="card p-6 flex flex-col gap-5">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Contact Us</h3>
            <p className="text-xs text-brand-400 mt-0.5">
              Reach out to the Kashu affiliate support team
            </p>
          </div>

          <div className="space-y-4">
            <ContactRow
              icon={
                <svg className="w-4 h-4 text-accent" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
                </svg>
              }
              label="Email Support"
              value="affiliates@kashupay.com"
              href="mailto:affiliates@kashupay.com"
            />
            <ContactRow
              icon={
                <svg className="w-4 h-4 text-accent" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" />
                </svg>
              }
              label="Knowledge Base"
              value="help.kashupay.com"
              href="https://help.kashupay.com"
            />
            <ContactRow
              icon={
                <svg className="w-4 h-4 text-accent" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" />
                </svg>
              }
              label="Phone"
              value="Available during business hours"
            />
          </div>

          <p className="text-xs text-brand-400 leading-relaxed">
            Our support team typically responds within 24 hours on business days.
            For urgent issues, please include &quot;URGENT&quot; in your email subject line.
          </p>
        </div>

        {/* FAQ */}
        <div className="card p-6 flex flex-col gap-5">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Frequently Asked Questions</h3>
            <p className="text-xs text-brand-400 mt-0.5">Quick answers to common questions</p>
          </div>

          <div className="space-y-4">
            <FaqItem
              q="How do I earn commissions?"
              a="Gold and Platinum tier partners earn a commission on the first transaction each referred user completes. Gold tier earns 5% of Kashu's fee, Platinum earns 10%. Whitelabel partners earn on every transaction a client runs."
            />
            <FaqItem
              q="How do I reach Platinum tier?"
              a="Reach $250,000 in total referred transaction volume to unlock Platinum tier, which doubles your commission rate from 5% to 10%."
            />
            <FaqItem
              q="When do I get paid?"
              a="Payouts are processed on a regular schedule. You can request a payout from the Payouts page once your approved balance reaches the minimum threshold."
            />
            <FaqItem
              q="How does attribution work?"
              a="When someone clicks your unique referral link and signs up for a Kashu Wallet account, they are permanently attributed to you. You earn commissions on all their future transactions."
            />
            <FaqItem
              q="Can I have multiple referral links?"
              a="Currently each affiliate has one unique referral link. You can share it across any channel. Contact support if you need campaign tracking."
            />
          </div>
        </div>
      </div>
    </>
  );
}

function ContactRow({
  icon,
  label,
  value,
  href,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  href?: string;
}) {
  return (
    <div className="flex items-center gap-3 py-2">
      <div className="w-8 h-8 rounded-xl bg-accent/10 border border-accent/15 flex items-center justify-center flex-shrink-0">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] text-brand-400 uppercase tracking-wider font-medium">{label}</p>
        {href ? (
          <a
            href={href}
            className="text-sm text-brand-600 hover:text-accent transition-colors"
            target={href.startsWith("http") ? "_blank" : undefined}
            rel={href.startsWith("http") ? "noopener noreferrer" : undefined}
          >
            {value}
          </a>
        ) : (
          <p className="text-sm text-gray-900">{value}</p>
        )}
      </div>
    </div>
  );
}

function FaqItem({ q, a }: { q: string; a: string }) {
  return (
    <div className="border-b border-surface-200/60 pb-3 last:border-0 last:pb-0">
      <p className="text-sm font-semibold text-gray-900 mb-1">{q}</p>
      <p className="text-xs text-brand-400 leading-relaxed">{a}</p>
    </div>
  );
}
