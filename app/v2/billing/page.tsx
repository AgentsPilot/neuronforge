import { redirect } from 'next/navigation'

// P-10b (Business OS plan payments, WS-3): the agent-platform buy flow is
// retired, so this page no longer renders its own billing screen. It stays as
// a redirect because the dashboard, the run page, the user menu and the help
// texts still link here; the read-only billing view lives in Settings.
export default function V2BillingPage(): never {
  redirect('/settings?tab=billing')
}
