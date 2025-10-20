'use client'

import React, { useState } from 'react'
import {
  Crown,
  Zap,
  Check,
  Database,
  Clock,
  Shield,
  Sparkles,
  CreditCard,
  Calendar,
  TrendingUp,
  Download,
  Settings,
  Activity
} from 'lucide-react'

export default function PlanManagementTab() {
  const [currentPlan] = useState('free')

  const planDetails = {
    name: 'Free Plan',
    status: 'Active',
    startDate: '2024-01-15',
    nextBilling: null,
    price: 0,
    agents: { used: 3, limit: 5 },
    requests: { used: 45, limit: 100 },
    storage: { used: 150, limit: 500 }
  }

  const billingHistory = [
    { id: 1, date: '2024-01-15', amount: 0, status: 'Paid', plan: 'Free' },
  ]

  const features = {
    current: [
      { name: '5 Agents' },
      { name: '100 AI Requests/month' },
      { name: 'Basic Plugins' },
      { name: 'Community Support' },
    ],
    upgrade: [
      { name: '50 Agents' },
      { name: '5,000 AI Requests/month' },
      { name: 'All Plugins' },
      { name: 'Priority Support' },
      { name: 'Advanced Analytics' },
    ]
  }

  return (
    <div className="space-y-6">
      {/* Current Plan Overview */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-200/50 rounded-xl p-3 hover:shadow-md transition-all duration-300">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg flex items-center justify-center flex-shrink-0 shadow-lg">
              <Crown className="h-5 w-5 text-white" />
            </div>
            <div>
              <p className="text-xs text-blue-700 font-medium">Current Plan</p>
              <p className="text-xl font-bold text-blue-900 capitalize">{currentPlan}</p>
            </div>
          </div>
        </div>

        <div className="bg-gradient-to-br from-emerald-50 to-teal-50 border border-emerald-200/50 rounded-xl p-3 hover:shadow-md transition-all duration-300">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-lg flex items-center justify-center flex-shrink-0 shadow-lg">
              <Zap className="h-5 w-5 text-white" />
            </div>
            <div>
              <p className="text-xs text-emerald-700 font-medium">Requests</p>
              <p className="text-xl font-bold text-emerald-900">{planDetails.requests.used}/{planDetails.requests.limit}</p>
            </div>
          </div>
        </div>

        <div className="bg-gradient-to-br from-purple-50 to-pink-50 border border-purple-200/50 rounded-xl p-3 hover:shadow-md transition-all duration-300">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-pink-600 rounded-lg flex items-center justify-center flex-shrink-0 shadow-lg">
              <Database className="h-5 w-5 text-white" />
            </div>
            <div>
              <p className="text-xs text-purple-700 font-medium">Agents</p>
              <p className="text-xl font-bold text-purple-900">{planDetails.agents.used}/{planDetails.agents.limit}</p>
            </div>
          </div>
        </div>

        <div className="bg-gradient-to-br from-orange-50 to-red-50 border border-orange-200/50 rounded-xl p-3 hover:shadow-md transition-all duration-300">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-orange-500 to-red-600 rounded-lg flex items-center justify-center flex-shrink-0 shadow-lg">
              <Activity className="h-5 w-5 text-white" />
            </div>
            <div>
              <p className="text-xs text-orange-700 font-medium">Storage</p>
              <p className="text-xl font-bold text-orange-900">{planDetails.storage.used}MB</p>
            </div>
          </div>
        </div>
      </div>

      {/* Plan Details Card */}
      <div className="bg-white/80 backdrop-blur-sm border border-gray-200/50 rounded-xl p-6 shadow-sm">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h3 className="text-lg font-bold text-gray-900 mb-1">Plan Details</h3>
            <p className="text-sm text-gray-600">Manage your subscription and billing</p>
          </div>
          <button className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-lg hover:from-indigo-700 hover:to-purple-700 transition-all duration-300 text-sm font-semibold shadow-md">
            <TrendingUp className="w-4 h-4" />
            Upgrade Plan
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 rounded-xl bg-gradient-to-br from-gray-50 to-white border border-gray-200/50">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg flex items-center justify-center shadow-md">
                  <Crown className="w-5 h-5 text-white" />
                </div>
                <div>
                  <p className="text-xs text-gray-600 font-medium">Plan Name</p>
                  <p className="text-base font-bold text-gray-900">{planDetails.name}</p>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between p-4 rounded-xl bg-gradient-to-br from-gray-50 to-white border border-gray-200/50">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-lg flex items-center justify-center shadow-md">
                  <Check className="w-5 h-5 text-white" />
                </div>
                <div>
                  <p className="text-xs text-gray-600 font-medium">Status</p>
                  <p className="text-base font-bold text-emerald-900">{planDetails.status}</p>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between p-4 rounded-xl bg-gradient-to-br from-gray-50 to-white border border-gray-200/50">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-pink-600 rounded-lg flex items-center justify-center shadow-md">
                  <Calendar className="w-5 h-5 text-white" />
                </div>
                <div>
                  <p className="text-xs text-gray-600 font-medium">Start Date</p>
                  <p className="text-base font-bold text-gray-900">{new Date(planDetails.startDate).toLocaleDateString()}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 rounded-xl bg-gradient-to-br from-gray-50 to-white border border-gray-200/50">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-gradient-to-br from-orange-500 to-red-600 rounded-lg flex items-center justify-center shadow-md">
                  <Clock className="w-5 w-5 text-white" />
                </div>
                <div>
                  <p className="text-xs text-gray-600 font-medium">Next Billing</p>
                  <p className="text-base font-bold text-gray-900">{planDetails.nextBilling || 'N/A'}</p>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between p-4 rounded-xl bg-gradient-to-br from-gray-50 to-white border border-gray-200/50">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-gradient-to-br from-green-500 to-emerald-600 rounded-lg flex items-center justify-center shadow-md">
                  <CreditCard className="w-5 h-5 text-white" />
                </div>
                <div>
                  <p className="text-xs text-gray-600 font-medium">Monthly Cost</p>
                  <p className="text-base font-bold text-gray-900">${planDetails.price}</p>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between p-4 rounded-xl bg-gradient-to-br from-gray-50 to-white border border-gray-200/50">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-cyan-600 rounded-lg flex items-center justify-center shadow-md">
                  <Settings className="w-5 h-5 text-white" />
                </div>
                <div>
                  <p className="text-xs text-gray-600 font-medium">Auto Renewal</p>
                  <p className="text-base font-bold text-gray-900">N/A</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Usage Progress */}
      <div className="bg-white/80 backdrop-blur-sm border border-gray-200/50 rounded-xl p-6 shadow-sm">
        <h3 className="text-lg font-bold text-gray-900 mb-4">Usage This Month</h3>

        <div className="space-y-4">
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Database className="w-4 h-4 text-purple-600" />
                <span className="text-sm font-semibold text-gray-900">Agents</span>
              </div>
              <span className="text-sm font-bold text-gray-900">{planDetails.agents.used}/{planDetails.agents.limit}</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-purple-500 to-pink-600 rounded-full transition-all duration-300"
                style={{ width: `${(planDetails.agents.used / planDetails.agents.limit) * 100}%` }}
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-emerald-600" />
                <span className="text-sm font-semibold text-gray-900">AI Requests</span>
              </div>
              <span className="text-sm font-bold text-gray-900">{planDetails.requests.used}/{planDetails.requests.limit}</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-emerald-500 to-teal-600 rounded-full transition-all duration-300"
                style={{ width: `${(planDetails.requests.used / planDetails.requests.limit) * 100}%` }}
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-orange-600" />
                <span className="text-sm font-semibold text-gray-900">Storage</span>
              </div>
              <span className="text-sm font-bold text-gray-900">{planDetails.storage.used}MB/{planDetails.storage.limit}MB</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-orange-500 to-red-600 rounded-full transition-all duration-300"
                style={{ width: `${(planDetails.storage.used / planDetails.storage.limit) * 100}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Features Comparison */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white/80 backdrop-blur-sm border border-gray-200/50 rounded-xl p-6 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg flex items-center justify-center shadow-md">
              <Check className="w-4 h-4 text-white" />
            </div>
            <h3 className="text-base font-bold text-gray-900">Current Features</h3>
          </div>

          <div className="space-y-2">
            {features.current.map((feature, idx) => (
              <div key={idx} className="flex items-center gap-2 p-2 rounded-lg hover:bg-gray-50 transition-colors">
                <div className="w-5 h-5 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-full flex items-center justify-center flex-shrink-0">
                  <Check className="w-3 h-3 text-white" />
                </div>
                <span className="text-sm text-gray-900 font-medium">{feature.name}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-gradient-to-br from-indigo-50 to-purple-50 border border-indigo-200/50 rounded-xl p-6 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 bg-gradient-to-br from-indigo-600 to-purple-600 rounded-lg flex items-center justify-center shadow-md">
              <TrendingUp className="w-4 h-4 text-white" />
            </div>
            <h3 className="text-base font-bold text-indigo-900">Unlock with Upgrade</h3>
          </div>

          <div className="space-y-2 mb-4">
            {features.upgrade.map((feature, idx) => (
              <div key={idx} className="flex items-center gap-2 p-2 rounded-lg hover:bg-white/50 transition-colors">
                <div className="w-5 h-5 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-full flex items-center justify-center flex-shrink-0">
                  <Sparkles className="w-3 h-3 text-white" />
                </div>
                <span className="text-sm text-indigo-900 font-medium">{feature.name}</span>
              </div>
            ))}
          </div>

          <button className="w-full py-2.5 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-lg hover:from-indigo-700 hover:to-purple-700 transition-all duration-300 text-sm font-semibold shadow-md">
            Upgrade to Pro
          </button>
        </div>
      </div>

      {/* Billing History */}
      <div className="bg-white/80 backdrop-blur-sm border border-gray-200/50 rounded-xl p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-gray-900">Billing History</h3>
          <button className="inline-flex items-center gap-2 px-3 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-all duration-300 text-xs font-semibold">
            <Download className="w-4 h-4" />
            Export
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-3 px-4 text-xs font-semibold text-gray-600">Date</th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-gray-600">Plan</th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-gray-600">Amount</th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-gray-600">Status</th>
              </tr>
            </thead>
            <tbody>
              {billingHistory.map((bill) => (
                <tr key={bill.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                  <td className="py-3 px-4 text-sm text-gray-900">{new Date(bill.date).toLocaleDateString()}</td>
                  <td className="py-3 px-4 text-sm text-gray-900">{bill.plan}</td>
                  <td className="py-3 px-4 text-sm font-semibold text-gray-900">${bill.amount.toFixed(2)}</td>
                  <td className="py-3 px-4">
                    <span className="inline-flex items-center gap-1 px-2 py-1 bg-emerald-100 text-emerald-700 rounded-full text-xs font-semibold">
                      <Check className="w-3 h-3" />
                      {bill.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Info Notice */}
      <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-200/50 rounded-xl p-6">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl flex items-center justify-center flex-shrink-0 shadow-lg">
            <Shield className="w-6 h-6 text-white" />
          </div>
          <div>
            <h4 className="font-bold text-blue-900 mb-2">Need help with your plan?</h4>
            <p className="text-sm text-blue-800 mb-3">
              Our team is here to help you choose the right plan for your needs. Contact us anytime for personalized assistance.
            </p>
            <button className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-lg hover:from-blue-700 hover:to-indigo-700 transition-all duration-300 text-sm font-semibold shadow-md">
              Contact Support
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
