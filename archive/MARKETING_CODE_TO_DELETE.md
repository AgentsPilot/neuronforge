# Marketing Code to Delete from NeuronForge

**Date Created**: December 17, 2024
**Reason**: Marketing functionality moved to separate `agentspilot-marketing` repository
**Action**: DO NOT DELETE YET - Keep as fallback until agentspilot-marketing is fully deployed and tested

---

## Critical: Before Deletion Checklist

- [ ] agentspilot-marketing deployed to Vercel and working
- [ ] Custom domain configured for agentspilot-marketing (agentspilot.ai)
- [ ] SessionHandler tested and working in neuronforge
- [ ] Complete user flow tested (Signup → Onboarding → Dashboard)
- [ ] Google OAuth tested with both environments
- [ ] All marketing redirects point to agentspilot-marketing
- [ ] Production URLs updated in both environments
- [ ] At least 1 week of successful production operation

---

## Files and Folders to Delete

### Main Marketing Folder
```
/app/(marketing)/
```

**Contents**:
- `about/` - About page (moved to agentspilot-marketing)
- `blog/` - Blog page (moved to agentspilot-marketing)
- `contact/` - Contact page with form (moved to agentspilot-marketing)
- `features/` - Features page (moved to agentspilot-marketing)
- `login/` - Login page (DUPLICATE - keep agentspilot-marketing version)
- `pricing/` - Pricing page with calculator (moved to agentspilot-marketing)
- `signup/` - Signup page (DUPLICATE - keep agentspilot-marketing version)
- `use-cases/` - Use cases page (moved to agentspilot-marketing)
- `layout.tsx` - Marketing layout with header/footer (moved to agentspilot-marketing)
- `page.tsx` - Marketing home page (moved to agentspilot-marketing)
- `page-old.tsx` - Old home page (safe to delete immediately)

### Additional Marketing-Related Files

**Components** (check if used elsewhere before deleting):
```
/components/billing/PilotCreditCalculator.tsx
```
- If only used by marketing pages, can be deleted
- If used in dashboard/admin, keep it

**API Routes for Marketing**:
```
/app/api/newsletter/subscribe/route.ts
```
- Newsletter subscription (moved to agentspilot-marketing)
- Check if used by main app before deleting

---

## Do NOT Delete

### Keep These Files:
1. **SessionHandler**: `/components/SessionHandler.tsx`
   - Required for receiving session from marketing site
   - CRITICAL - do not delete

2. **Supabase Client**: `/lib/supabaseClient.ts`
   - Shared authentication infrastructure
   - Keep

3. **Onboarding**: `/app/onboarding/`
   - Full onboarding flow stays in main app
   - Users are redirected here from marketing site
   - Keep

4. **Auth Callback**: `/app/auth/callback/`
   - OAuth callback for main app
   - Keep

---

## Deletion Strategy

### Phase 1: Add TODO Comments (DONE NOW)
Mark all marketing files with comments:
```tsx
// TODO: DELETE - Moved to agentspilot-marketing repo
// This file is duplicated and maintained in separate marketing site
// Safe to delete after marketing site is deployed and tested
```

### Phase 2: Test Period (1-2 weeks after marketing site deployment)
- Monitor for any unexpected issues
- Ensure no internal links break
- Verify all features work correctly

### Phase 3: Create Archive Branch
Before deletion:
```bash
git checkout -b archive/marketing-code-pre-deletion
git push origin archive/marketing-code-pre-deletion
```

### Phase 4: Delete Marketing Code
```bash
# Remove marketing folder
rm -rf app/\(marketing\)

# Remove old home page
rm app/page-old.tsx

# Check and remove marketing-specific API routes
# (verify not used by main app first)

# Commit deletion
git add .
git commit -m "chore: Remove marketing code (moved to agentspilot-marketing repo)"
git push
```

---

## Rollback Plan

If issues occur after deletion:
1. Restore from archive branch:
   ```bash
   git checkout archive/marketing-code-pre-deletion -- app/\(marketing\)
   ```

2. Or temporarily redirect main app root to marketing site:
   ```javascript
   // next.config.js
   async redirects() {
     return [
       {
         source: '/',
         destination: process.env.NEXT_PUBLIC_MARKETING_URL,
         permanent: false,
       }
     ]
   }
   ```

---

## Post-Deletion Updates

After safe deletion:

### Update next.config.js
Remove any marketing-specific redirects or rewrites

### Update .gitignore
No changes needed

### Update Documentation
- Update README to mention separate marketing repo
- Document two-repo architecture
- Link to agentspilot-marketing repo

---

## Notes

- Marketing folder last updated: December 17, 2024
- Total size: ~150KB of code
- Dependencies: Framer Motion (used elsewhere), Lucide React (used elsewhere)
- No database migrations needed (shared Supabase instance)
- No environment variables to remove

---

## Related Documentation

- See `agentspilot-marketing/DEPLOYMENT_GUIDE.md` for deployment instructions
- See `docs/TWO_REPO_DEPLOYMENT_GUIDE.md` for architecture overview
- See `agentspilot-marketing/MAIN_APP_SESSION_HANDLER.tsx` for session transfer implementation

---

**Last Updated**: December 17, 2024
**Status**: Marked for deletion - DO NOT DELETE YET
