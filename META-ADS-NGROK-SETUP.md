# Meta Ads OAuth Setup with Ngrok (HTTPS Solution)

## The Problem
Meta requires HTTPS for OAuth callbacks even in Development/Test mode, but localhost uses HTTP.

## The Solution: Ngrok
Ngrok creates a secure public HTTPS URL that tunnels to your localhost:3000.

---

## Step 1: Install Ngrok

### Option A: Download Binary (Recommended)
1. Go to https://ngrok.com/download
2. Download for macOS
3. Unzip the file
4. Move to `/usr/local/bin`:
   ```bash
   sudo mv ngrok /usr/local/bin/
   ```

### Option B: Using Homebrew
```bash
brew install ngrok/ngrok/ngrok
```

---

## Step 2: Create Ngrok Account (Free)

1. Go to https://dashboard.ngrok.com/signup
2. Sign up (free tier is enough)
3. Copy your authtoken from https://dashboard.ngrok.com/get-started/your-authtoken
4. Run:
   ```bash
   ngrok config add-authtoken YOUR_AUTH_TOKEN
   ```

---

## Step 3: Start Your Dev Server

```bash
npm run dev
```

Keep this running in one terminal.

---

## Step 4: Start Ngrok in Another Terminal

Open a new terminal and run:
```bash
ngrok http 3000
```

You'll see output like:
```
Session Status                online
Account                       your-email@example.com
Version                       3.x.x
Region                        United States (us)
Latency                       -
Web Interface                 http://127.0.0.1:4040
Forwarding                    https://abc123.ngrok-free.app -> http://localhost:3000
```

**Copy the HTTPS URL**: `https://abc123.ngrok-free.app`

---

## Step 5: Update Meta App Settings

1. Go to https://developers.facebook.com/apps
2. Select your app
3. Go to **Settings** → **Advanced**
4. Find **"Authorize callback URL"** field
5. Add your ngrok URL:
   ```
   https://abc123.ngrok-free.app/oauth/callback/meta-ads
   ```
6. Click **"Save Changes"**

---

## Step 6: Update Environment Variables

Edit your `.env.local` file:

```bash
# Meta Ads API Credentials
META_ADS_CLIENT_ID=your_app_id_here
META_ADS_CLIENT_SECRET=your_app_secret_here

# IMPORTANT: Use your ngrok HTTPS URL
NEXT_PUBLIC_APP_URL=https://abc123.ngrok-free.app
```

**Replace `abc123.ngrok-free.app` with YOUR actual ngrok URL from Step 4.**

---

## Step 7: Restart Your Dev Server

1. Stop the dev server (Ctrl+C)
2. Start it again:
   ```bash
   npm run dev
   ```

---

## Step 8: Test the Connection

1. Open your browser and go to your ngrok URL:
   ```
   https://abc123.ngrok-free.app
   ```

2. You might see an ngrok warning page - click **"Visit Site"**

3. Go to your NeuronForge dashboard

4. Open the **Plugins** dialog (footer button)

5. Find **"Meta Ads"** and click **"Connect"**

6. You'll be redirected to Facebook to authorize

7. Grant permissions and you should be redirected back successfully!

---

## Important Notes

### Ngrok Free Tier Limitations
- ✅ HTTPS support (what we need!)
- ✅ Persistent URL during session
- ❌ URL changes every time you restart ngrok
- ❌ Session timeout after 2 hours (free tier)

### Every Time You Restart Ngrok:
1. You'll get a NEW URL (e.g., `https://xyz789.ngrok-free.app`)
2. Update Meta's "Authorize callback URL" with the new URL
3. Update `NEXT_PUBLIC_APP_URL` in `.env.local` with the new URL
4. Restart dev server

### Paid Ngrok ($8/month):
- ✅ Static domain (URL never changes)
- ✅ No session timeout
- If you use Meta Ads plugin frequently, this is worth it

---

## Troubleshooting

### "Invalid OAuth Redirect URI"
- **Cause**: URL in Meta doesn't match your ngrok URL
- **Fix**: Double-check the URL in Meta settings matches exactly (including `/oauth/callback/meta-ads`)

### "Connection Failed" or "Network Error"
- **Cause**: Dev server not running or ngrok not running
- **Fix**: Make sure BOTH are running (two separate terminals)

### Ngrok Warning Page Every Time
- **Cause**: Free tier shows interstitial warning
- **Fix**: Just click "Visit Site" - this is normal for free tier

### Can't Find Plugin in Dialog
- **Cause**: Server not restarted after .env changes
- **Fix**: Restart dev server (Ctrl+C then `npm run dev`)

---

## Quick Start Commands

**Terminal 1 (Dev Server):**
```bash
npm run dev
```

**Terminal 2 (Ngrok):**
```bash
ngrok http 3000
```

**Copy the HTTPS URL from ngrok output and update:**
1. Meta App Settings → Advanced → Authorize callback URL
2. `.env.local` → `NEXT_PUBLIC_APP_URL`
3. Restart dev server

---

## Production Alternative

For production (when deploying to Vercel/Netlify):
- You'll have a permanent HTTPS domain (e.g., `https://neuronforge.vercel.app`)
- Update Meta's callback URL to: `https://neuronforge.vercel.app/oauth/callback/meta-ads`
- No need for ngrok in production!

---

**Ready to connect your Meta Ads account!** 🚀

Once ngrok is running and URLs are updated, the OAuth flow should work perfectly.
