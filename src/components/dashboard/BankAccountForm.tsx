"use client";

import { useState, useCallback } from "react";

interface ExistingAccount {
  account_name: string;
  is_verified: boolean;
  last4?: string;
}

interface Props {
  existingAccount?: ExistingAccount | null;
  expandedByDefault?: boolean;
}

interface FormErrors {
  account_holder_name?: string;
  routing_number?: string;
  account_number?: string;
}

export default function BankAccountForm({ existingAccount, expandedByDefault }: Props) {
  const [showForm, setShowForm] = useState(!existingAccount || !!expandedByDefault);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [apiError, setApiError] = useState("");
  const [errors, setErrors] = useState<FormErrors>({});

  // Displayed account (updates after successful save)
  const [displayAccount, setDisplayAccount] = useState<ExistingAccount | null>(
    existingAccount ?? null
  );

  const [accountHolderName, setAccountHolderName] = useState("");
  const [routingNumber, setRoutingNumber] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [accountType, setAccountType] = useState<"checking" | "savings">("checking");

  const validate = useCallback((): FormErrors => {
    const errs: FormErrors = {};
    if (!accountHolderName.trim()) {
      errs.account_holder_name = "Account holder name is required";
    }
    if (!routingNumber.trim()) {
      errs.routing_number = "Routing number is required";
    } else if (!/^\d{9}$/.test(routingNumber)) {
      errs.routing_number = "Routing number must be exactly 9 digits";
    }
    if (!accountNumber.trim()) {
      errs.account_number = "Account number is required";
    } else if (!/^\d{4,17}$/.test(accountNumber)) {
      errs.account_number = "Account number must be 4-17 digits";
    }
    return errs;
  }, [accountHolderName, routingNumber, accountNumber]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setApiError("");
    setSuccess(false);

    const errs = validate();
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setSubmitting(true);
    try {
      const res = await fetch("/api/payouts/mercury-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account_holder_name: accountHolderName.trim(),
          routing_number: routingNumber,
          account_number: accountNumber,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setApiError(data.error ?? "Something went wrong. Please try again.");
        return;
      }

      // Success
      const last4 = data.last4 ?? accountNumber.slice(-4);
      setDisplayAccount({
        account_name: accountHolderName.trim(),
        is_verified: true,
        last4,
      });
      setSuccess(true);
      setShowForm(false);

      // Reset form
      setAccountHolderName("");
      setRoutingNumber("");
      setAccountNumber("");
      setAccountType("checking");
      setErrors({});
    } catch {
      setApiError("Network error. Please check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  // Only allow digits in routing/account number fields
  function handleDigitInput(
    value: string,
    setter: (v: string) => void
  ) {
    setter(value.replace(/\D/g, ""));
  }

  return (
    <div className="card p-6">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-accent/10 border border-accent/20 flex items-center justify-center flex-shrink-0">
          <svg className="w-5 h-5 text-accent" fill="none" viewBox="0 0 24 24" strokeWidth={1.6} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 21v-8.25M15.75 21v-8.25M8.25 21v-8.25M3 9l9-6 9 6m-1.5 12V10.332A48.36 48.36 0 0012 9.75c-2.551 0-5.056.2-7.5.582V21M3 21h18M12 6.75h.008v.008H12V6.75z" />
          </svg>
        </div>
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Bank Account for Payouts</h3>
          <p className="text-xs text-brand-400">ACH direct deposit via Mercury</p>
        </div>
      </div>

      {/* Success message */}
      {success && (
        <div className="bg-accent/10 border border-accent/30 text-brand-600 rounded-lg p-4 text-sm mb-4">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-accent flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Bank account saved successfully.
          </div>
        </div>
      )}

      {/* Display existing/saved account */}
      {displayAccount && !showForm && (
        <div className="space-y-3">
          <div className="flex items-center gap-3 p-3 rounded-lg bg-gray-50 border border-gray-100">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">
                {displayAccount.account_name}
              </p>
              <p className="text-xs text-brand-400">
                Account ending in ····{displayAccount.last4 ?? "····"} ·{" "}
                <span className={displayAccount.is_verified ? "text-accent" : "text-amber-400"}>
                  {displayAccount.is_verified ? "verified" : "pending"}
                </span>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              setShowForm(true);
              setSuccess(false);
            }}
            className="text-sm font-medium text-brand-600 hover:text-brand-700 transition-colors"
          >
            Update bank details
          </button>
        </div>
      )}

      {/* Bank account form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="space-y-4">
          {!displayAccount && (
            <p className="text-sm text-brand-400 mb-2">
              Enter your bank account details to receive ACH payouts.
            </p>
          )}

          {/* Account Holder Name */}
          <div>
            <label htmlFor="account_holder_name" className="block text-sm font-medium text-gray-700 mb-1">
              Account Holder Name
            </label>
            <input
              id="account_holder_name"
              type="text"
              value={accountHolderName}
              onChange={(e) => setAccountHolderName(e.target.value)}
              placeholder="Name on the bank account"
              className="w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-gray-900 placeholder-gray-400 focus:border-brand-600 focus:ring-1 focus:ring-brand-600 text-sm"
            />
            {errors.account_holder_name && (
              <p className="text-red-500 text-xs mt-1">{errors.account_holder_name}</p>
            )}
          </div>

          {/* Routing Number */}
          <div>
            <label htmlFor="routing_number" className="block text-sm font-medium text-gray-700 mb-1">
              Routing Number
            </label>
            <input
              id="routing_number"
              type="text"
              inputMode="numeric"
              maxLength={9}
              value={routingNumber}
              onChange={(e) => handleDigitInput(e.target.value, setRoutingNumber)}
              placeholder="9-digit routing number"
              className="w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-gray-900 placeholder-gray-400 focus:border-brand-600 focus:ring-1 focus:ring-brand-600 text-sm"
            />
            {errors.routing_number && (
              <p className="text-red-500 text-xs mt-1">{errors.routing_number}</p>
            )}
          </div>

          {/* Account Number */}
          <div>
            <label htmlFor="account_number" className="block text-sm font-medium text-gray-700 mb-1">
              Account Number
            </label>
            <input
              id="account_number"
              type="text"
              inputMode="numeric"
              maxLength={17}
              value={accountNumber}
              onChange={(e) => handleDigitInput(e.target.value, setAccountNumber)}
              placeholder="Account number"
              className="w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-gray-900 placeholder-gray-400 focus:border-brand-600 focus:ring-1 focus:ring-brand-600 text-sm"
            />
            {errors.account_number && (
              <p className="text-red-500 text-xs mt-1">{errors.account_number}</p>
            )}
          </div>

          {/* Account Type */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Account Type
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setAccountType("checking")}
                className={`flex-1 py-2 px-4 rounded-xl text-sm font-medium border transition-colors ${
                  accountType === "checking"
                    ? "bg-brand-600 text-white border-brand-600"
                    : "bg-white text-gray-700 border-gray-200 hover:border-brand-600 hover:text-brand-600"
                }`}
              >
                Checking
              </button>
              <button
                type="button"
                onClick={() => setAccountType("savings")}
                className={`flex-1 py-2 px-4 rounded-xl text-sm font-medium border transition-colors ${
                  accountType === "savings"
                    ? "bg-brand-600 text-white border-brand-600"
                    : "bg-white text-gray-700 border-gray-200 hover:border-brand-600 hover:text-brand-600"
                }`}
              >
                Savings
              </button>
            </div>
          </div>

          {/* API Error */}
          {apiError && (
            <div className="bg-red-50 text-red-600 border border-red-200 rounded-lg p-3 text-sm">
              {apiError}
            </div>
          )}

          {/* Security note */}
          <p className="text-xs text-gray-400">
            <svg className="w-3.5 h-3.5 inline-block mr-1 -mt-0.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
            </svg>
            Your bank details are encrypted and stored securely. Only Kashu administrators can initiate payouts to your account.
          </p>

          {/* Actions */}
          <div className="flex items-center gap-3 pt-1">
            <button
              type="submit"
              disabled={submitting}
              className="btn-primary text-sm flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {submitting ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Saving...
                </>
              ) : (
                "Save Bank Account"
              )}
            </button>
            {displayAccount && (
              <button
                type="button"
                onClick={() => {
                  setShowForm(false);
                  setErrors({});
                  setApiError("");
                }}
                className="text-sm text-brand-400 hover:text-gray-700 transition-colors"
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      )}
    </div>
  );
}
