# 🚀 Vercel Deployment Setup Guide

## ✅ Required Configuration Steps

### 1. Vercel Environment Variables

Add these environment variables in your Vercel project settings:

**Navigate to:** Vercel Dashboard → Your Project → Settings → Environment Variables

```env
# Production URLs
NEXTAUTH_URL=https://neuronforge-kohl.vercel.app
NEXT_PUBLIC_APP_URL=https://neuronforge-kohl.vercel.app

# Supabase (copy from .env.local)
NEXT_PUBLIC_SUPABASE_URL=https://jgccgkyhpwirgknnceoh.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpnY2Nna3locHdpcmdrbm5jZW9oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIxNjY3OTMsImV4cCI6MjA2Nzc0Mjc5M30.h6VfcNOsEusgykZ9nR8mUStMrmbePp4ThFLlZHpqtWo
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpnY2Nna3locHdpcmdrbm5jZW9oIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1MjE2Njc5MywiZXhwIjoyMDY3NzQyNzkzfQ.NkUzCksSNNDy0UNr3jD-JYPAHUfEBKXc4wM6zqGEr2s
SUPABASE_URL=https://jgccgkyhpwirgknnceoh.supabase.co

# OpenAI
OPENAI_API_KEY=[your-key]

# Other API Keys (copy from .env.local)
GMAIL_CLIENT_ID=[your-key]
GMAIL_CLIENT_SECRET=[your-key]
SLACK_CLIENT_ID=[your-key]
SLACK_CLIENT_SECRET=[your-key]
# ... add all other keys
```

**Important:** Set all variables to apply to **Production, Preview, and Development** environments.

---

### 2. Supabase Redirect URL Configuration

**Navigate to:** Supabase Dashboard → Authentication → URL Configuration

Add these URLs to the **Redirect URLs** allowlist:

```
https://neuronforge-kohl.vercel.app/auth/callback
https://neuronforge-kohl.vercel.app
```

Also add any preview deployment URLs if needed:
```
https://*-neuronforge-kohl.vercel.app/auth/callback
```

---

### 3. OAuth Provider Redirect URIs

Update redirect URIs in all connected OAuth providers:

#### **Google Cloud Console** (for Gmail, Calendar, Drive)
1. Go to: https://console.cloud.google.com/apis/credentials
2. Select your OAuth 2.0 Client ID
3. Add to **Authorized redirect URIs**:
   ```
   https://neuronforge-kohl.vercel.app/api/oauth/google-mail/token
   https://neuronforge-kohl.vercel.app/api/oauth/google-calendar/token
   https://neuronforge-kohl.vercel.app/api/oauth/google-drive/token
   ```
4. Save changes

#### **Slack App** (for Slack integration)
1. Go to: https://api.slack.com/apps
2. Select your app
3. Go to **OAuth & Permissions**
4. Add to **Redirect URLs**:
   ```
   https://neuronforge-kohl.vercel.app/api/oauth/slack/token
   ```
5. Save URLs

#### **HubSpot App** (if using HubSpot)
1. Go to: HubSpot Developer Portal
2. Select your app
3. Update Redirect URL to:
   ```
   https://neuronforge-kohl.vercel.app/api/oauth/hubspot/token
   ```

---

### 4. Supabase Row Level Security (RLS)

Ensure the `profiles` table has proper RLS policies:

```sql
-- Allow users to read their own profile
CREATE POLICY "Users can view own profile"
ON profiles FOR SELECT
USING (auth.uid() = id);

-- Allow users to insert their own profile (for signup)
CREATE POLICY "Users can create own profile"
ON profiles FOR INSERT
WITH CHECK (auth.uid() = id);

-- Allow users to update their own profile (for onboarding)
CREATE POLICY "Users can update own profile"
ON profiles FOR UPDATE
USING (auth.uid() = id);
```

---

## 🔧 Recent Fixes Applied

### 1. **Profile Creation Issue** ✅
- **Problem:** Signup didn't create profiles automatically, causing onboarding failures
- **Fix:** Updated `saveOnboardingData()` to use `.upsert()` instead of `.update()`, so it creates the profile if it doesn't exist

### 2. **Auth Callback Improvements** ✅
- **Problem:** No profile creation after email verification
- **Fix:** Auth callback now attempts to create profile automatically, with fallback to onboarding upsert

### 3. **Better Error Handling** ✅
- **Problem:** Generic error messages made debugging difficult
- **Fix:** Added detailed console logging and user-friendly error messages for:
  - Rate limiting
  - Invalid emails
  - Password requirements
  - Existing accounts
  - Network/connection errors

---

## 🧪 Testing Checklist

After deploying to Vercel, test the following flow:

- [ ] Visit signup page: `https://neuronforge-kohl.vercel.app/signup`
- [ ] Create new account with valid email
- [ ] Check email for verification link
- [ ] Click verification link → Should redirect to `/auth/callback`
- [ ] Auth callback should show "Setting up your account..."
- [ ] Should automatically redirect to `/onboarding`
- [ ] Complete onboarding steps (Profile, Domain, Plugins, Role)
- [ ] Click "Complete Setup" → Should create/update profile and redirect to `/dashboard`
- [ ] Verify profile exists in Supabase `profiles` table

---

## 🚨 Common Issues & Solutions

### Issue: "Failed to verify email"
**Cause:** Supabase redirect URL not configured
**Solution:** Add `https://neuronforge-kohl.vercel.app/auth/callback` to Supabase URL Configuration

### Issue: "Failed to update profile"
**Cause:** RLS policies not configured on `profiles` table
**Solution:** Run the RLS policy SQL commands above in Supabase SQL Editor

### Issue: "OAuth provider error"
**Cause:** Redirect URIs not updated in OAuth provider
**Solution:** Update redirect URIs in Google/Slack/HubSpot as documented above

### Issue: Environment variables not working
**Cause:** Variables not set for all environments
**Solution:** Ensure variables are set for Production, Preview, AND Development in Vercel settings

---

## 📊 Monitoring

After deployment, monitor these logs:

### Browser Console
```javascript
// Successful signup flow should show:
"Signup response: { data: {...}, error: null }"
"User data: { id: '...', email: '...', ... }"

// Auth callback should show:
"=== AUTH CALLBACK START ==="
"Session data: { session: {...} }"
"User found: { id: '...', email: '...', ... }"
"Profile created successfully" // or "Profile already exists"
"Onboarding status: false"
"User needs to complete onboarding, redirecting to /onboarding..."
```

### Vercel Function Logs
Check Vercel Dashboard → Your Project → Logs for any server-side errors

### Supabase Logs
Check Supabase Dashboard → Logs for authentication and database errors

---

## 🎯 Next Steps After Deployment

1. **Test the full signup flow** with a real email address
2. **Monitor error logs** for the first few signups
3. **Update documentation** with any additional findings
4. **Set up error tracking** (e.g., Sentry) for production monitoring
5. **Test OAuth flows** for each connected plugin

---

## 📝 Notes

- **Email Confirmation:** Currently enabled in Supabase. Users must verify email before accessing the platform.
- **Profile Table:** Now uses `.upsert()` to handle both creation and updates automatically.
- **Fallback Handling:** If profile creation fails at any step, onboarding will handle it as a final safety net.

---

## 🆘 Support

If you encounter issues after following this guide:

1. Check browser console for detailed error logs
2. Check Vercel function logs
3. Check Supabase auth logs
4. Verify all environment variables are set correctly
5. Verify all redirect URLs are configured in OAuth providers

For urgent issues, contact: support@neuronforge.com
