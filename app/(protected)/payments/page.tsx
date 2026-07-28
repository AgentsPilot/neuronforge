'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { PaymentTransactionList } from '@/components/payments/PaymentTransactionList';
import { PaymentInvoiceList } from '@/components/payments/PaymentInvoiceList';
import { StripeConnectStatus } from '@/components/payments/StripeConnectStatus';

export default function PaymentsPage() {
  const [activeTab, setActiveTab] = useState<'transactions' | 'invoices' | 'settings'>('transactions');

  return (
    <div className="min-h-screen bg-slate-50 p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-slate-900">Payments</h1>
          <p className="text-slate-600 mt-2">Manage transactions, invoices, and payment settings</p>
        </div>

        {/* Stripe Connect Status Banner */}
        <div className="mb-6">
          <StripeConnectStatus />
        </div>

        {/* Tabs */}
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
          <div className="border-b border-slate-200">
            <nav className="flex space-x-8 px-6" aria-label="Tabs">
              <button
                onClick={() => setActiveTab('transactions')}
                className={`py-4 px-1 border-b-2 font-medium text-sm ${
                  activeTab === 'transactions'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
                }`}
              >
                Transactions
              </button>
              <button
                onClick={() => setActiveTab('invoices')}
                className={`py-4 px-1 border-b-2 font-medium text-sm ${
                  activeTab === 'invoices'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
                }`}
              >
                Invoices
              </button>
              <button
                onClick={() => setActiveTab('settings')}
                className={`py-4 px-1 border-b-2 font-medium text-sm ${
                  activeTab === 'settings'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
                }`}
              >
                Settings
              </button>
            </nav>
          </div>

          <div className="p-6">
            {activeTab === 'transactions' && <PaymentTransactionList />}
            {activeTab === 'invoices' && <PaymentInvoiceList />}
            {activeTab === 'settings' && (
              <div className="space-y-6">
                <StripeConnectStatus detailed />
                <div className="pt-6 border-t border-slate-200">
                  <h3 className="text-lg font-semibold text-slate-900 mb-4">Payment Settings</h3>
                  <p className="text-slate-600 text-sm">Configure your payment preferences and integrations.</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
