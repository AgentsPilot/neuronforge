# Two-Repository Deployment Guide

## Architecture Overview

This project uses a **two-repository deployment architecture**:

- **Marketing Repository** (`agentspilot-marketing`): Contains marketing pages, landing page, features, pricing, etc.
  - Deployed to: `https://agentspilot.com` (main domain)
  - Separate Git repository
  - Separate Vercel project

- **App Repository** (`neuronforge`): Contains the main application with authentication, agents, workflows, etc.
  - Deployed to: `https://app.agentspilot.com` (subdomain)
  - Separate Git repository
  - Already configured on Vercel

Both repositories are **independent Next.js applications** that link to each other using absolute URLs.

---

## Marketing Repository Setup

### 1. Directory Structure

The marketing repository should have this structure:

```
agentspilot-marketing/
├── app/
│   ├── (marketing)/
│   │   ├── about/
│   │   │   └── page.tsx
│   │   ├── features/
│   │   │   └── page.tsx
│   │   ├── pricing/
│   │   │   └── page.tsx
│   │   ├── blog/
│   │   │   └── page.tsx
│   │   ├── contact/
│   │   │   └── page.tsx
│   │   ├── use-cases/
│   │   │   └── page.tsx
│   │   ├── layout.tsx
│   │   └── page.tsx (root landing page)
│   ├── layout.tsx (root layout)
│   └── globals.css
├── components/
│   ├── marketing/
│   │   ├── NewsletterForm.tsx
│   │   ├── FeatureCard.tsx
│   │   └── ...other marketing components
│   └── ui/
│       └── PluginIcon.tsx (if needed)
├── public/
│   └── images/
│       └── ...marketing images
├── lib/
│   └── utils.ts
├── next.config.js
├── tailwind.config.js
├── tsconfig.json
├── package.json
└── README.md
```

### 2. Files to Copy from Neuronforge

Copy the following from the `neuronforge` repository:

1. **Marketing Pages**:
   - `app/(marketing)/` entire directory
   - Move contents up so `app/(marketing)/page.tsx` becomes `app/page.tsx`

2. **Components**:
   - Any components used by marketing pages
   - `components/ui/PluginIcon.tsx` (if referenced)
   - Newsletter, feature cards, etc.

3. **Images**:
   - All images referenced in marketing pages from `public/images/`

4. **Styling**:
   - Relevant Tailwind configuration
   - Global CSS for marketing pages

### 3. Package.json Dependencies

Create `package.json` with these core dependencies:

```json
{
  "name": "agentspilot-marketing",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint"
  },
  "dependencies": {
    "next": "^14.0.0",
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "lucide-react": "latest",
    "clsx": "^2.0.0",
    "tailwind-merge": "^2.0.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/react": "^18.2.0",
    "@types/react-dom": "^18.2.0",
    "autoprefixer": "^10.0.0",
    "postcss": "^8.0.0",
    "tailwindcss": "^3.3.0",
    "typescript": "^5.0.0"
  }
}
```

### 4. Next.js Configuration

Create `next.config.js`:

```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  poweredByHeader: false,

  // Optional: Add redirects for old routes
  async redirects() {
    return [
      {
        source: '/signup',
        destination: 'https://app.agentspilot.com/signup',
        permanent: false,
      },
      {
        source: '/login',
        destination: 'https://app.agentspilot.com/login',
        permanent: false,
      },
    ]
  },
}

module.exports = nextConfig
```

### 5. Update Marketing Links

Update all navigation links to use absolute URLs for app routes:

```tsx
// In marketing layout navigation
<Link href="https://app.agentspilot.com/signup">
  Get Started
</Link>

<Link href="https://app.agentspilot.com/login">
  Login
</Link>

// Marketing internal links remain relative
<Link href="/features">Features</Link>
<Link href="/pricing">Pricing</Link>
```

---

## Marketing Deployment to Vercel

### 1. Create New Vercel Project

1. Go to [Vercel Dashboard](https://vercel.com/dashboard)
2. Click **"Add New Project"**
3. Import the `agentspilot-marketing` Git repository
4. Configure the project:
   - **Framework Preset**: Next.js
   - **Root Directory**: `./` (root)
   - **Build Command**: `npm run build`
   - **Output Directory**: `.next`

### 2. Configure Domain

1. In Vercel project settings, go to **Domains**
2. Add your main domain: `agentspilot.com`
3. Add www redirect: `www.agentspilot.com` → `agentspilot.com`

### 3. DNS Configuration

In your domain registrar (e.g., GoDaddy, Namecheap, Cloudflare):

**For Main Domain (`agentspilot.com`)**:
```
Type: A
Name: @
Value: 76.76.21.21 (Vercel IP)
TTL: 3600
```

**For WWW Subdomain**:
```
Type: CNAME
Name: www
Value: cname.vercel-dns.com
TTL: 3600
```

### 4. Environment Variables

Set these in Vercel project settings → Environment Variables:

```bash
# Required
NODE_ENV=production

# App Cross-Linking
NEXT_PUBLIC_APP_URL=https://app.agentspilot.com

# Optional: Analytics
NEXT_PUBLIC_GA_ID=G-XXXXXXXXXX
```

### 5. Deploy

1. Push code to your marketing repository
2. Vercel will automatically deploy
3. Monitor deployment in Vercel dashboard
4. Verify at `https://agentspilot.com`

---

## App Repository Cleanup (Neuronforge)

### 1. Remove Marketing Directory

Since marketing is now in a separate repo, clean up the app repository:

```bash
# Remove marketing directory
rm -rf app/(marketing)

# Also remove any marketing-only components if they exist
# rm -rf components/marketing (if applicable)
```

### 2. Update Middleware

Edit [middleware.ts](../middleware.ts) to remove marketing route checks:

**Before**:
```typescript
if (
  pathname.startsWith('/_next') ||
  pathname.startsWith('/api') ||
  pathname === '/' ||
  pathname.startsWith('/login') ||
  pathname.startsWith('/signup') ||
  pathname.startsWith('/about') ||        // Remove these
  pathname.startsWith('/features') ||     // Remove these
  pathname.startsWith('/pricing') ||      // Remove these
  pathname.startsWith('/blog') ||         // Remove these
  pathname.startsWith('/contact')         // Remove these
) {
  return NextResponse.next()
}
```

**After**:
```typescript
if (
  pathname.startsWith('/_next') ||
  pathname.startsWith('/api') ||
  pathname.startsWith('/oauth') ||
  pathname.startsWith('/auth') ||
  pathname.startsWith('/login') ||
  pathname.startsWith('/signup') ||
  pathname.startsWith('/onboarding') ||
  pathname.startsWith('/v2') ||
  pathname.startsWith('/admin') ||
  pathname.startsWith('/test-plugins-v2')
) {
  return NextResponse.next()
}
```

### 3. Update Environment Variables

Ensure these are set in Vercel for the app project:

```bash
# Add marketing URL for cross-linking
NEXT_PUBLIC_MARKETING_URL=https://agentspilot.com
```

See [VERCEL_ENV_SETUP.md](./VERCEL_ENV_SETUP.md) for complete list.

### 4. Verify App Domain

Ensure `app.agentspilot.com` is configured in Vercel:

1. Go to neuronforge project → **Domains**
2. Verify `app.agentspilot.com` is listed
3. If not, add it and configure DNS:

```
Type: CNAME
Name: app
Value: cname.vercel-dns.com
TTL: 3600
```

---

## Cross-Linking Configuration

### Marketing → App Links

In marketing repository, use absolute URLs:

```tsx
// components/marketing/Header.tsx
<Link href="https://app.agentspilot.com/signup" className="btn-primary">
  Get Started
</Link>

<Link href="https://app.agentspilot.com/login" className="btn-secondary">
  Login
</Link>

// In CTAs
<a href="https://app.agentspilot.com/onboarding">
  Start Building
</a>
```

### App → Marketing Links

In app repository, use environment variable:

```tsx
// components/Footer.tsx
const marketingUrl = process.env.NEXT_PUBLIC_MARKETING_URL || 'https://agentspilot.com'

<Link href={`${marketingUrl}/features`}>Features</Link>
<Link href={`${marketingUrl}/pricing`}>Pricing</Link>
<Link href={`${marketingUrl}/about`}>About</Link>
<Link href={`${marketingUrl}/contact`}>Contact</Link>
```

Or use absolute URLs directly:

```tsx
<Link href="https://agentspilot.com/features">Features</Link>
```

---

## External Services Update

### 1. Supabase Configuration

Update redirect URLs in Supabase dashboard:

1. Go to **Authentication** → **URL Configuration**
2. Add both domains to **Redirect URLs**:
   ```
   https://agentspilot.com/auth/callback
   https://app.agentspilot.com/auth/callback
   https://app.agentspilot.com/oauth/callback
   ```
3. Set **Site URL**: `https://app.agentspilot.com`

### 2. OAuth Providers

Update redirect URIs for each provider:

**Google OAuth** (`console.cloud.google.com`):
```
Authorized redirect URIs:
- https://app.agentspilot.com/oauth/google/callback
- https://app.agentspilot.com/auth/callback
```

**Slack OAuth** (`api.slack.com/apps`):
```
Redirect URLs:
- https://app.agentspilot.com/oauth/slack/callback
```

**HubSpot OAuth** (`developers.hubspot.com`):
```
Redirect URLs:
- https://app.agentspilot.com/oauth/hubspot/callback
```

See [VERCEL_DEPLOYMENT_SETUP.md](./VERCEL_DEPLOYMENT_SETUP.md) for detailed OAuth setup.

### 3. Nango Configuration

If using Nango for OAuth:

1. Update callback URLs in Nango dashboard
2. Set in both Vercel projects:
   ```bash
   NANGO_PUBLIC_KEY=your_key
   NANGO_CALLBACK_URL=https://app.agentspilot.com/oauth/callback
   ```

---

## Testing Checklist

### Marketing Site (`agentspilot.com`)

- [ ] Homepage loads correctly
- [ ] All navigation links work
- [ ] Features page displays properly
- [ ] Pricing page displays properly
- [ ] "Get Started" button redirects to `app.agentspilot.com/signup`
- [ ] "Login" button redirects to `app.agentspilot.com/login`
- [ ] Newsletter form works (if applicable)
- [ ] Mobile responsive design works
- [ ] Images load correctly
- [ ] Contact form works (if applicable)

### App Site (`app.agentspilot.com`)

- [ ] Login page works
- [ ] Signup flow completes successfully
- [ ] Google OAuth redirects correctly
- [ ] Slack OAuth redirects correctly
- [ ] Dashboard loads after authentication
- [ ] Agent creation works
- [ ] Workflow execution works
- [ ] Settings page loads
- [ ] Links to marketing site work (footer, etc.)
- [ ] Scheduled cron jobs run correctly

### Cross-Site Integration

- [ ] Clicking "Get Started" on marketing goes to app signup
- [ ] Clicking "Features" in app goes to marketing features
- [ ] No CORS errors in browser console
- [ ] No mixed content warnings (HTTP vs HTTPS)
- [ ] Session persistence works after navigation

### DNS and SSL

- [ ] `agentspilot.com` resolves correctly
- [ ] `www.agentspilot.com` redirects to `agentspilot.com`
- [ ] `app.agentspilot.com` resolves correctly
- [ ] SSL certificates are valid for both domains
- [ ] No certificate warnings in browsers

---

## Deployment Workflow

### Marketing Updates

1. Make changes in `agentspilot-marketing` repository
2. Commit and push to Git
3. Vercel automatically deploys to `agentspilot.com`
4. Monitor deployment in Vercel dashboard

### App Updates

1. Make changes in `neuronforge` repository
2. Commit and push to Git
3. Vercel automatically deploys to `app.agentspilot.com`
4. Monitor deployment in Vercel dashboard

### Coordinated Releases

If both sites need updates simultaneously:

1. Deploy marketing changes first
2. Verify marketing deployment succeeds
3. Deploy app changes second
4. Test cross-linking between sites

---

## Troubleshooting

### Marketing Site Not Loading

1. Check DNS configuration in domain registrar
2. Verify domain is added in Vercel project settings
3. Check Vercel deployment logs for build errors
4. Ensure all dependencies are in `package.json`

### App Links Broken

1. Verify `NEXT_PUBLIC_APP_URL` is set correctly in marketing project
2. Check that URLs use `https://` protocol
3. Test in incognito mode to rule out cache issues

### OAuth Redirect Errors

1. Verify all redirect URLs are updated in OAuth provider dashboards
2. Check Supabase redirect URL configuration
3. Ensure URLs match exactly (trailing slashes matter)
4. Check browser console for specific error messages

### CORS Errors

1. Ensure both sites use HTTPS (not mixed HTTP/HTTPS)
2. Check that API routes allow cross-origin requests if needed
3. Verify cookies are set with correct domain attributes

---

## Environment Variables Reference

### Marketing Project (`agentspilot.com`)

```bash
NODE_ENV=production
NEXT_PUBLIC_APP_URL=https://app.agentspilot.com
# Optional: Analytics
NEXT_PUBLIC_GA_ID=G-XXXXXXXXXX
```

### App Project (`app.agentspilot.com`)

See [VERCEL_ENV_SETUP.md](./VERCEL_ENV_SETUP.md) for complete list including:
- Supabase credentials
- OpenAI API key
- OAuth credentials
- Redis URL
- Cron secret
- And more...

Add this for cross-linking:
```bash
NEXT_PUBLIC_MARKETING_URL=https://agentspilot.com
```

---

## Additional Resources

- [Next.js Deployment Documentation](https://nextjs.org/docs/deployment)
- [Vercel Custom Domains Guide](https://vercel.com/docs/concepts/projects/domains)
- [DNS Configuration Guide](https://vercel.com/docs/concepts/projects/domains/add-a-domain)
- [VERCEL_DEPLOYMENT_SETUP.md](./VERCEL_DEPLOYMENT_SETUP.md) - OAuth and RLS setup
- [VERCEL_ENV_SETUP.md](./VERCEL_ENV_SETUP.md) - Complete environment variables list

---

## Summary

**Two-Repo Architecture**:
- Marketing repo → `agentspilot.com` (main domain)
- App repo → `app.agentspilot.com` (subdomain)
- Each deployed as separate Vercel project
- Cross-linked using absolute URLs

**Key Steps**:
1. Set up marketing repository with copied files
2. Deploy marketing to Vercel on main domain
3. Clean up app repository (remove marketing directory)
4. Update middleware and cross-links in app
5. Configure DNS for both domains
6. Update OAuth and Supabase redirect URLs
7. Test both sites and cross-linking

This architecture provides clear separation of concerns, independent deployment cycles, and easier scaling.
