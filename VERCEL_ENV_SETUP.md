# Vercel Environment Variables Setup Guide

## 🔴 Critical Issue Detected

Your Vercel deployment is failing with a **500: INTERNAL_DEPLOYMENT_FETCH_FAILED** error. The most likely cause is **missing environment variables**, particularly `SUPABASE_SERVICE_ROLE_KEY`.

## 📋 Environment Variables Checklist

### ✅ Variables Present Locally (Need to be added to Vercel)

All required variables are present in your local `.env.local` file. You need to add them to Vercel.

### 🔴 Critical Variables (MUST ADD)

These are **absolutely required** for the app to work:

| Variable | Purpose | Value Location |
|----------|---------|----------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | `.env.local` line 5 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase public key | `.env.local` line 6 |
| `SUPABASE_SERVICE_ROLE_KEY` | **CRITICAL** - Admin API access | `.env.local` line 7 |
| `OPENAI_API_KEY` | OpenAI GPT-4 API | `.env.local` line 11 |

**⚠️ Without `SUPABASE_SERVICE_ROLE_KEY`, all admin routes will fail:**
- `/api/admin/dashboard`
- `/api/admin/users`
- `/api/admin/users/[id]/terminate`
- `/api/admin/messages`
- `/api/admin/token-usage`

### ⚡ High Priority Variables (Strongly Recommended)

Required for core features like scheduling and OAuth:

| Variable | Purpose | Value Location |
|----------|---------|----------------|
| `REDIS_URL` | Agent queue system (BullMQ) | `.env.local` line 42 |
| `CRON_SECRET` | Secure cron endpoints | `.env.local` line 51 |
| `GOOGLE_CLIENT_ID` | Google OAuth | `.env.local` line 15 |
| `GOOGLE_CLIENT_SECRET` | Google OAuth | `.env.local` line 16 |

### 🔌 Medium Priority Variables (Plugin Features)

Required for Gmail, Drive, and other integrations:

| Variable | Purpose | Value Location |
|----------|---------|----------------|
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | Google client (public) | `.env.local` line 14 |
| `GMAIL_CLIENT_ID` | Gmail API | `.env.local` line 19 |
| `GMAIL_CLIENT_SECRET` | Gmail API | `.env.local` line 20 |
| `NEXT_PUBLIC_APP_URL` | **Must be production URL** | Should be `https://neuronforge-kohl.vercel.app` |

### 📦 Optional Variables (Nice to Have)

These enhance functionality but aren't critical:

- `GOOGLE_SEARCH_ENGINE_ID` - For web search plugin
- `GOOGLE_SEARCH_API_KEY` - For web search plugin
- `GMAIL_USER` - Contact form email sender
- `GMAIL_REFRESH_TOKEN` - Contact form OAuth
- `AGENT_WORKER_CONCURRENCY` - Worker pool size (default: 3)
- `NODE_ENV` - Set to `production`
- `NEXTAUTH_SECRET` - NextAuth encryption
- `NEXTAUTH_URL` - NextAuth callback URL
- `ENCRYPTION_SECRET` - Credential encryption

---

## 🚀 How to Add Variables to Vercel

### Option 1: Via Vercel Dashboard (Recommended)

1. **Go to Vercel Dashboard**
   - Visit: https://vercel.com/dashboard
   - Select your project: `neuronforge`

2. **Navigate to Environment Variables**
   - Click on **Settings** tab
   - Click on **Environment Variables** in the left sidebar

3. **Add Each Variable**
   - Click **Add New** button
   - For each variable:
     - Enter the **Variable Name** (e.g., `SUPABASE_SERVICE_ROLE_KEY`)
     - Enter the **Value** (copy from `.env.local`)
     - Select **Environments**: Check all three boxes:
       - ✅ Production
       - ✅ Preview
       - ✅ Development
     - Click **Save**

4. **Important Notes**
   - **DO NOT** add `NEXT_PUBLIC_APP_URL` as `http://localhost:3000`
   - Set it to: `https://neuronforge-kohl.vercel.app`
   - Copy values EXACTLY as they appear in `.env.local`
   - Secrets should remain secret (don't share them)

### Option 2: Via Vercel CLI (Advanced)

If you have Vercel CLI installed:

```bash
# Install Vercel CLI if needed
npm i -g vercel

# Login to Vercel
vercel login

# Link your project
vercel link

# Add critical variables
vercel env add NEXT_PUBLIC_SUPABASE_URL production
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY production
vercel env add SUPABASE_SERVICE_ROLE_KEY production
vercel env add OPENAI_API_KEY production
vercel env add REDIS_URL production
vercel env add CRON_SECRET production
vercel env add GOOGLE_CLIENT_ID production
vercel env add GOOGLE_CLIENT_SECRET production

# For each command, paste the value from .env.local when prompted
```

---

## 🔧 Fixing the 500 Error

### Step-by-Step Resolution

1. **Add Critical Variables** (5 minutes)
   - Add all 4 critical variables from the table above
   - Pay special attention to `SUPABASE_SERVICE_ROLE_KEY`

2. **Add High Priority Variables** (3 minutes)
   - Add Redis and OAuth variables
   - These are needed for scheduling and integrations

3. **Update NEXT_PUBLIC_APP_URL** (1 minute)
   - Change from `http://localhost:3000`
   - To: `https://neuronforge-kohl.vercel.app`

4. **Trigger Redeploy** (2 minutes)
   - Go to **Deployments** tab in Vercel
   - Click **...** menu on latest deployment
   - Select **Redeploy**
   - OR simply push a new commit to trigger auto-deploy

5. **Verify Deployment** (3 minutes)
   - Wait for deployment to complete
   - Visit: https://neuronforge-kohl.vercel.app/
   - Check if error is resolved
   - Test admin routes: https://neuronforge-kohl.vercel.app/admin

---

## 🔍 Troubleshooting

### If Error Persists After Adding Variables

1. **Check Vercel Deployment Logs**
   ```
   - Go to Vercel Dashboard → Deployments
   - Click on latest deployment
   - Click on "View Function Logs"
   - Look for specific error messages
   ```

2. **Verify Variables Are Set**
   ```
   - Go to Settings → Environment Variables
   - Verify all critical variables are present
   - Check they're enabled for "Production"
   ```

3. **Check for Typos**
   - Variable names are case-sensitive
   - Values should be copied exactly (no extra spaces)
   - JWT tokens should be complete (very long strings)

4. **Test Specific Routes**
   ```
   - Test: https://neuronforge-kohl.vercel.app/api/system/health
   - Test: https://neuronforge-kohl.vercel.app/admin
   - Check browser console for specific errors
   ```

### Common Issues

| Error | Cause | Fix |
|-------|-------|-----|
| 500 on admin routes | Missing `SUPABASE_SERVICE_ROLE_KEY` | Add service role key |
| OAuth not working | Missing Google credentials | Add `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` |
| Scheduling fails | Missing Redis or CRON_SECRET | Add `REDIS_URL` and `CRON_SECRET` |
| Agent execution fails | Missing OpenAI key | Add `OPENAI_API_KEY` |

---

## 📊 Quick Reference: What Each Route Needs

| Route | Required Variables |
|-------|-------------------|
| `/api/admin/*` | `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL` |
| `/api/run-agent` | `OPENAI_API_KEY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| `/api/generate-agent` | `OPENAI_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY` |
| `/api/contact` | `GMAIL_USER`, `GMAIL_REFRESH_TOKEN`, `GMAIL_CLIENT_ID` |
| `/api/run-scheduled-agents` | `CRON_SECRET`, `REDIS_URL` |
| OAuth callbacks | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |

---

## ✅ Final Checklist

Before redeploying, verify:

- [ ] All 4 CRITICAL variables added to Vercel
- [ ] All 4 HIGH PRIORITY variables added to Vercel
- [ ] `NEXT_PUBLIC_APP_URL` set to production URL (not localhost)
- [ ] All variables enabled for "Production" environment
- [ ] No typos in variable names or values
- [ ] Service role key is the long JWT token (not anon key)
- [ ] Ready to trigger redeploy

---

## 🎯 Expected Result

After adding variables and redeploying:

✅ https://neuronforge-kohl.vercel.app/ loads successfully
✅ Admin dashboard accessible at `/admin`
✅ User management works at `/admin/users`
✅ Agent creation and execution functional
✅ OAuth integrations work
✅ Scheduled jobs run properly

---

## 📞 Need Help?

If you're still experiencing issues after following this guide:

1. Check Vercel deployment logs for specific errors
2. Verify all environment variables are correctly set
3. Try a fresh deployment from the Vercel dashboard
4. Check browser console for client-side errors

---

**Last Updated**: 2025-10-20
**Related Files**: `.env.local`, `verify-env.js`
**Deployment URL**: https://neuronforge-kohl.vercel.app/
