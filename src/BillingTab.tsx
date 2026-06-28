export function BillingTab() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-800">Billing</h2>
        <p className="text-sm text-slate-500 mt-0.5">Payment history and invoices</p>
      </div>
      <div className="text-center py-16 text-slate-400">
        <div className="text-4xl mb-3">💳</div>
        <p className="text-sm">Payment history coming soon.</p>
        <p className="text-xs mt-1">To manage your subscription, use <strong>Renew Subscription</strong> in the sidebar.</p>
      </div>
    </div>
  );
}