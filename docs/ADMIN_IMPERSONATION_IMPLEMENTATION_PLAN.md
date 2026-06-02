# Admin User Impersonation Feature - Implementation Plan

## Overview

This document outlines the implementation plan for an admin impersonation feature that allows administrators to view and interact with the system as any non-admin user. This is useful for debugging, support, and understanding user experiences.

---

## Requirements Summary

| Requirement | Decision |
|-------------|----------|
| State Storage | Hybrid (Cookie + Database) |
| Admin Identification | `profiles.role = 'admin'` |
| Audit Logging | Full (start, end, all actions) |
| Who Can Be Impersonated | Non-admin users only |
| UI Indicator | Persistent banner at top of screen |
| Entry Point | "Impersonate" button in `/admin/users` |
| Admin Route Access | Blocked during impersonation |
| Session Expiry | 4 hours auto-expiry |

---

## Architecture

### High-Level Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                     IMPERSONATION LIFECYCLE                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────────┐  │
│  │ Admin User   │───▶│ /admin/users │───▶│ Click "Impersonate"  │  │
│  │ (logged in)  │    │    page      │    │ on target user       │  │
│  └──────────────┘    └──────────────┘    └──────────┬───────────┘  │
│                                                      │              │
│                                                      ▼              │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │           POST /api/admin/impersonate/start                   │  │
│  │  1. Verify caller is admin (profiles.role = 'admin')         │  │
│  │  2. Verify target user is NOT admin                          │  │
│  │  3. Check no active impersonation session exists             │  │
│  │  4. Create record in impersonation_sessions table            │  │
│  │  5. Set HTTP-only impersonation cookie                       │  │
│  │  6. Log to audit_trail (impersonation_started)               │  │
│  │  7. Return success + redirect to /dashboard                  │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                              │                                      │
│                              ▼                                      │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                   IMPERSONATION ACTIVE                        │  │
│  │                                                               │  │
│  │  • ImpersonationBanner visible at top of all pages           │  │
│  │  • useAuth() returns impersonated user as "effective user"   │  │
│  │  • All data queries use impersonated user's ID               │  │
│  │  • Middleware blocks access to /admin/* routes (403)         │  │
│  │  • All significant actions logged to audit_trail             │  │
│  │  • Session auto-expires after 4 hours                        │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                              │                                      │
│                              ▼                                      │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │           POST /api/admin/impersonate/end                     │  │
│  │  1. Validate impersonation cookie exists                     │  │
│  │  2. Verify session in database matches cookie                │  │
│  │  3. Update impersonation_sessions (is_active=false, ended_at)│  │
│  │  4. Clear impersonation cookie                               │  │
│  │  5. Log to audit_trail (impersonation_ended)                 │  │
│  │  6. Redirect to /admin/users                                 │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### Data Flow

```
┌─────────────┐     ┌─────────────────┐     ┌──────────────────┐
│   Browser   │────▶│  Next.js API    │────▶│    Supabase      │
│   Cookie    │     │    Routes       │     │    Database      │
└─────────────┘     └─────────────────┘     └──────────────────┘
       │                    │                        │
       │   impersonation    │   Verify session      │  impersonation_sessions
       │   cookie with      │   + Create records    │  audit_trail
       │   session ID       │   + Log actions       │  profiles (role check)
       │                    │                        │
       ▼                    ▼                        ▼
┌─────────────────────────────────────────────────────────────────┐
│                     UserProvider Context                         │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────────┐   │
│  │ realUser      │  │ effectiveUser │  │ impersonation     │   │
│  │ (admin)       │  │ (target user) │  │ { isActive, ... } │   │
│  └───────────────┘  └───────────────┘  └───────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Database Schema

### New Table: `impersonation_sessions`

```sql
-- SQL Migration: Create impersonation_sessions table
-- File: supabase/migrations/YYYYMMDD_create_impersonation_sessions.sql

CREATE TABLE impersonation_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Who is impersonating whom
  admin_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  impersonated_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Session timing
  started_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  ended_at TIMESTAMP WITH TIME ZONE,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,  -- 4 hours from started_at

  -- Session state
  is_active BOOLEAN DEFAULT true NOT NULL,

  -- Additional metadata (IP, user agent, reason, etc.)
  metadata JSONB DEFAULT '{}'::jsonb,

  -- Constraints
  CONSTRAINT different_users CHECK (admin_user_id != impersonated_user_id)
);

-- Index for quick active session lookups
CREATE INDEX idx_impersonation_sessions_active
  ON impersonation_sessions(admin_user_id, is_active)
  WHERE is_active = true;

-- Index for finding sessions by impersonated user
CREATE INDEX idx_impersonation_sessions_target
  ON impersonation_sessions(impersonated_user_id, is_active);

-- Row Level Security
ALTER TABLE impersonation_sessions ENABLE ROW LEVEL SECURITY;

-- Only service role can access (admin operations only)
CREATE POLICY "Service role full access" ON impersonation_sessions
  FOR ALL
  USING (auth.role() = 'service_role');

-- Comment for documentation
COMMENT ON TABLE impersonation_sessions IS
  'Tracks admin impersonation sessions for audit and security purposes';
```

### Audit Trail Events Schema

The existing `audit_trail` table will be used with these event types:

```typescript
// Audit event types for impersonation
type ImpersonationAuditEvent = {
  user_id: string;           // The admin user who initiated
  action: 'impersonation_started' | 'impersonation_ended' | 'impersonation_action';
  entity_type: 'impersonation';
  entity_id: string;         // impersonation_sessions.id
  details: {
    admin_user_id: string;
    admin_email: string;
    impersonated_user_id: string;
    impersonated_email: string;
    action_taken?: string;      // For 'impersonation_action' events
    route_accessed?: string;    // Page/API route accessed
    duration_minutes?: number;  // For 'impersonation_ended' events
  };
  created_at: string;
};
```

---

## Cookie Structure

### Cookie Name: `nf_impersonation`

```typescript
// Cookie configuration
const IMPERSONATION_COOKIE_CONFIG = {
  name: 'nf_impersonation',
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 60 * 60 * 4, // 4 hours in seconds
};

// Cookie payload structure
interface ImpersonationCookiePayload {
  sessionId: string;              // UUID from impersonation_sessions
  adminUserId: string;            // Original admin's auth.users.id
  adminEmail: string;             // Admin's email for display
  impersonatedUserId: string;     // Target user's auth.users.id
  impersonatedEmail: string;      // Target user's email for banner display
  impersonatedName: string;       // Target user's display name
  startedAt: string;              // ISO timestamp
  expiresAt: string;              // ISO timestamp (4 hours from start)
}
```

---

## Implementation Files

### Files to Create

| File Path | Purpose |
|-----------|---------|
| `lib/impersonation.ts` | Core impersonation utilities and types |
| `lib/impersonation-server.ts` | Server-side impersonation helpers |
| `app/api/admin/impersonate/start/route.ts` | Start impersonation API endpoint |
| `app/api/admin/impersonate/end/route.ts` | End impersonation API endpoint |
| `app/api/admin/impersonate/status/route.ts` | Get current impersonation status |
| `components/ImpersonationBanner.tsx` | Persistent UI banner component |
| `components/ImpersonationProvider.tsx` | React context for impersonation state |
| `hooks/useImpersonation.ts` | Hook for accessing impersonation state |
| `supabase/migrations/YYYYMMDD_create_impersonation_sessions.sql` | Database migration |

### Files to Modify

| File Path | Changes |
|-----------|---------|
| `components/UserProvider.tsx` | Integrate impersonation state, expose `effectiveUser` |
| `middleware.ts` | Block admin routes during impersonation |
| `app/(protected)/layout.tsx` | Add ImpersonationBanner to layout |
| `app/admin/users/page.tsx` | Add "Impersonate" button for each non-admin user |
| `app/admin/layout.tsx` | Check for and block impersonation access |
| `lib/supabaseServer.ts` | Add helper to get effective user ID |

---

## Detailed Implementation

### 1. Core Types and Utilities

**File: `lib/impersonation.ts`**

```typescript
// Types
export interface ImpersonationSession {
  id: string;
  adminUserId: string;
  adminEmail: string;
  impersonatedUserId: string;
  impersonatedEmail: string;
  impersonatedName: string;
  startedAt: Date;
  expiresAt: Date;
  isActive: boolean;
}

export interface ImpersonationState {
  isImpersonating: boolean;
  session: ImpersonationSession | null;
}

// Cookie helpers
export function parseImpersonationCookie(cookieValue: string): ImpersonationCookiePayload | null;
export function createImpersonationCookie(payload: ImpersonationCookiePayload): string;
export function isImpersonationExpired(session: ImpersonationSession): boolean;

// Constants
export const IMPERSONATION_COOKIE_NAME = 'nf_impersonation';
export const IMPERSONATION_DURATION_HOURS = 4;
export const IMPERSONATION_DURATION_MS = 4 * 60 * 60 * 1000;
```

### 2. API Routes

**File: `app/api/admin/impersonate/start/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

export async function POST(request: NextRequest) {
  // 1. Get request body
  const { targetUserId } = await request.json();

  // 2. Create Supabase clients
  const supabaseAuth = await createAuthenticatedServerClient();
  const supabaseAdmin = createClient(url, serviceRoleKey);

  // 3. Verify caller is authenticated
  const { data: { user: adminUser } } = await supabaseAuth.auth.getUser();
  if (!adminUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 4. Verify caller is admin
  const { data: adminProfile } = await supabaseAdmin
    .from('profiles')
    .select('role, email, full_name')
    .eq('id', adminUser.id)
    .single();

  if (adminProfile?.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
  }

  // 5. Verify target user exists and is NOT admin
  const { data: targetProfile } = await supabaseAdmin
    .from('profiles')
    .select('id, role, email, full_name')
    .eq('id', targetUserId)
    .single();

  if (!targetProfile) {
    return NextResponse.json({ error: 'Target user not found' }, { status: 404 });
  }

  if (targetProfile.role === 'admin') {
    return NextResponse.json({ error: 'Cannot impersonate admin users' }, { status: 403 });
  }

  // 6. Check for existing active impersonation session
  const { data: existingSession } = await supabaseAdmin
    .from('impersonation_sessions')
    .select('id')
    .eq('admin_user_id', adminUser.id)
    .eq('is_active', true)
    .single();

  if (existingSession) {
    return NextResponse.json({
      error: 'Active impersonation session exists. End it first.'
    }, { status: 409 });
  }

  // 7. Create impersonation session in database
  const expiresAt = new Date(Date.now() + IMPERSONATION_DURATION_MS);

  const { data: session, error } = await supabaseAdmin
    .from('impersonation_sessions')
    .insert({
      admin_user_id: adminUser.id,
      impersonated_user_id: targetUserId,
      expires_at: expiresAt.toISOString(),
      metadata: {
        admin_email: adminProfile.email,
        target_email: targetProfile.email,
        user_agent: request.headers.get('user-agent'),
        ip: request.headers.get('x-forwarded-for') || 'unknown',
      }
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: 'Failed to create session' }, { status: 500 });
  }

  // 8. Log to audit trail
  await supabaseAdmin.from('audit_trail').insert({
    user_id: adminUser.id,
    action: 'impersonation_started',
    entity_type: 'impersonation',
    entity_id: session.id,
    details: {
      admin_user_id: adminUser.id,
      admin_email: adminProfile.email,
      impersonated_user_id: targetUserId,
      impersonated_email: targetProfile.email,
    }
  });

  // 9. Set HTTP-only cookie
  const cookiePayload: ImpersonationCookiePayload = {
    sessionId: session.id,
    adminUserId: adminUser.id,
    adminEmail: adminProfile.email || '',
    impersonatedUserId: targetUserId,
    impersonatedEmail: targetProfile.email || '',
    impersonatedName: targetProfile.full_name || targetProfile.email || 'Unknown',
    startedAt: new Date().toISOString(),
    expiresAt: expiresAt.toISOString(),
  };

  const cookieStore = await cookies();
  cookieStore.set(IMPERSONATION_COOKIE_NAME, JSON.stringify(cookiePayload), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: IMPERSONATION_DURATION_HOURS * 60 * 60,
  });

  // 10. Return success
  return NextResponse.json({
    success: true,
    session: {
      id: session.id,
      impersonatedUser: {
        id: targetUserId,
        email: targetProfile.email,
        name: targetProfile.full_name,
      },
      expiresAt: expiresAt.toISOString(),
    }
  });
}
```

**File: `app/api/admin/impersonate/end/route.ts`**

```typescript
export async function POST(request: NextRequest) {
  // 1. Get impersonation cookie
  const cookieStore = await cookies();
  const impersonationCookie = cookieStore.get(IMPERSONATION_COOKIE_NAME);

  if (!impersonationCookie) {
    return NextResponse.json({ error: 'No active impersonation' }, { status: 400 });
  }

  // 2. Parse and validate cookie
  const payload = JSON.parse(impersonationCookie.value) as ImpersonationCookiePayload;

  // 3. Verify session exists in database
  const { data: session } = await supabaseAdmin
    .from('impersonation_sessions')
    .select('*')
    .eq('id', payload.sessionId)
    .eq('is_active', true)
    .single();

  if (!session) {
    // Cookie exists but session doesn't - clear cookie anyway
    cookieStore.delete(IMPERSONATION_COOKIE_NAME);
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  // 4. Calculate duration
  const durationMinutes = Math.round(
    (Date.now() - new Date(session.started_at).getTime()) / 60000
  );

  // 5. Update session in database
  await supabaseAdmin
    .from('impersonation_sessions')
    .update({
      is_active: false,
      ended_at: new Date().toISOString(),
    })
    .eq('id', payload.sessionId);

  // 6. Log to audit trail
  await supabaseAdmin.from('audit_trail').insert({
    user_id: payload.adminUserId,
    action: 'impersonation_ended',
    entity_type: 'impersonation',
    entity_id: payload.sessionId,
    details: {
      admin_user_id: payload.adminUserId,
      admin_email: payload.adminEmail,
      impersonated_user_id: payload.impersonatedUserId,
      impersonated_email: payload.impersonatedEmail,
      duration_minutes: durationMinutes,
    }
  });

  // 7. Clear cookie
  cookieStore.delete(IMPERSONATION_COOKIE_NAME);

  // 8. Return success
  return NextResponse.json({
    success: true,
    durationMinutes,
  });
}
```

### 3. Middleware Updates

**File: `middleware.ts` (additions)**

```typescript
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const IMPERSONATION_COOKIE_NAME = 'nf_impersonation';

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Check for impersonation cookie
  const impersonationCookie = request.cookies.get(IMPERSONATION_COOKIE_NAME);

  if (impersonationCookie) {
    // Parse cookie to check expiration
    try {
      const payload = JSON.parse(impersonationCookie.value);
      const expiresAt = new Date(payload.expiresAt);

      // Check if expired
      if (expiresAt < new Date()) {
        // Clear expired cookie and redirect
        const response = NextResponse.redirect(new URL('/admin/users', request.url));
        response.cookies.delete(IMPERSONATION_COOKIE_NAME);
        return response;
      }

      // Block admin routes during impersonation
      if (pathname.startsWith('/admin')) {
        // Return 403 with helpful message
        return new NextResponse(
          JSON.stringify({
            error: 'Admin access blocked during impersonation',
            message: 'Please end your impersonation session to access admin pages.',
            impersonating: payload.impersonatedEmail,
          }),
          {
            status: 403,
            headers: { 'Content-Type': 'application/json' }
          }
        );
      }

      // Block impersonation API start (can't nest impersonations)
      if (pathname === '/api/admin/impersonate/start') {
        return new NextResponse(
          JSON.stringify({ error: 'Cannot start new impersonation while one is active' }),
          { status: 409, headers: { 'Content-Type': 'application/json' }}
        );
      }
    } catch (e) {
      // Invalid cookie - clear it
      const response = NextResponse.next();
      response.cookies.delete(IMPERSONATION_COOKIE_NAME);
      return response;
    }
  }

  // Continue with existing middleware logic...
  return NextResponse.next();
}

export const config = {
  matcher: [
    '/admin/:path*',
    '/api/admin/:path*',
    '/(protected)/:path*',
  ],
};
```

### 4. React Components

**File: `components/ImpersonationBanner.tsx`**

```typescript
'use client';

import { useImpersonation } from '@/hooks/useImpersonation';
import { useState } from 'react';

export function ImpersonationBanner() {
  const { isImpersonating, session, endImpersonation } = useImpersonation();
  const [isEnding, setIsEnding] = useState(false);

  if (!isImpersonating || !session) {
    return null;
  }

  const handleEndImpersonation = async () => {
    setIsEnding(true);
    try {
      await endImpersonation();
      window.location.href = '/admin/users';
    } catch (error) {
      console.error('Failed to end impersonation:', error);
      setIsEnding(false);
    }
  };

  // Calculate time remaining
  const expiresAt = new Date(session.expiresAt);
  const minutesRemaining = Math.max(0, Math.round((expiresAt.getTime() - Date.now()) / 60000));

  return (
    <div className="fixed top-0 left-0 right-0 z-[100] bg-amber-500 text-black px-4 py-2">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center px-2 py-1 rounded bg-amber-600 text-white text-xs font-semibold">
            IMPERSONATING
          </span>
          <span className="font-medium">
            Viewing as: <strong>{session.impersonatedName}</strong> ({session.impersonatedEmail})
          </span>
          <span className="text-amber-800 text-sm">
            {minutesRemaining} min remaining
          </span>
        </div>

        <button
          onClick={handleEndImpersonation}
          disabled={isEnding}
          className="px-4 py-1 bg-black text-white rounded hover:bg-gray-800 transition-colors disabled:opacity-50"
        >
          {isEnding ? 'Ending...' : 'End Impersonation'}
        </button>
      </div>
    </div>
  );
}
```

**File: `hooks/useImpersonation.ts`**

```typescript
'use client';

import { createContext, useContext, useState, useEffect, useCallback } from 'react';

interface ImpersonationContextValue {
  isImpersonating: boolean;
  session: ImpersonationSession | null;
  endImpersonation: () => Promise<void>;
  refreshStatus: () => Promise<void>;
}

const ImpersonationContext = createContext<ImpersonationContextValue | null>(null);

export function ImpersonationProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<ImpersonationSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refreshStatus = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/impersonate/status');
      if (response.ok) {
        const data = await response.json();
        setSession(data.session);
      } else {
        setSession(null);
      }
    } catch {
      setSession(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  const endImpersonation = useCallback(async () => {
    const response = await fetch('/api/admin/impersonate/end', { method: 'POST' });
    if (!response.ok) {
      throw new Error('Failed to end impersonation');
    }
    setSession(null);
  }, []);

  return (
    <ImpersonationContext.Provider value={{
      isImpersonating: !!session,
      session,
      endImpersonation,
      refreshStatus,
    }}>
      {children}
    </ImpersonationContext.Provider>
  );
}

export function useImpersonation() {
  const context = useContext(ImpersonationContext);
  if (!context) {
    throw new Error('useImpersonation must be used within ImpersonationProvider');
  }
  return context;
}
```

### 5. UserProvider Integration

**File: `components/UserProvider.tsx` (modifications)**

```typescript
// Add to existing UserProvider

export function UserProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [impersonation, setImpersonation] = useState<ImpersonationState | null>(null);
  // ... existing state

  // Computed effective user
  const effectiveUser = useMemo(() => {
    if (impersonation?.session) {
      // Return a user-like object for the impersonated user
      return {
        id: impersonation.session.impersonatedUserId,
        email: impersonation.session.impersonatedEmail,
        // Note: This is a simplified user object during impersonation
        // Full user data should be fetched separately if needed
      } as User;
    }
    return user;
  }, [user, impersonation]);

  // Fetch impersonation status on mount
  useEffect(() => {
    async function checkImpersonation() {
      try {
        const response = await fetch('/api/admin/impersonate/status');
        if (response.ok) {
          const data = await response.json();
          if (data.session) {
            setImpersonation({ isActive: true, session: data.session });
          }
        }
      } catch {
        // No impersonation active
      }
    }
    checkImpersonation();
  }, []);

  return (
    <UserContext.Provider value={{
      user: effectiveUser,        // The effective user (impersonated or real)
      realUser: user,             // Always the actual logged-in user
      isImpersonating: !!impersonation?.session,
      impersonation,
      // ... existing values
    }}>
      {children}
    </UserContext.Provider>
  );
}
```

### 6. Admin Users Page Update

**File: `app/admin/users/page.tsx` (additions)**

```typescript
// Add impersonate button to each user row

function UserRow({ user, onImpersonate }: { user: UserWithProfile; onImpersonate: (id: string) => void }) {
  const isAdmin = user.profile?.role === 'admin';

  return (
    <tr>
      {/* ... existing columns */}
      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
        <div className="flex gap-2 justify-end">
          {/* Existing actions */}

          {/* Impersonate button - only for non-admin users */}
          {!isAdmin && (
            <button
              onClick={() => onImpersonate(user.id)}
              className="text-indigo-600 hover:text-indigo-900 flex items-center gap-1"
              title="Impersonate this user"
            >
              <EyeIcon className="h-4 w-4" />
              <span>Impersonate</span>
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

// Add handler in parent component
const handleImpersonate = async (userId: string) => {
  if (!confirm('Start impersonating this user? You will be redirected to their dashboard view.')) {
    return;
  }

  try {
    const response = await fetch('/api/admin/impersonate/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetUserId: userId }),
    });

    if (!response.ok) {
      const error = await response.json();
      alert(error.error || 'Failed to start impersonation');
      return;
    }

    // Redirect to dashboard as impersonated user
    window.location.href = '/dashboard';
  } catch (error) {
    alert('Failed to start impersonation');
  }
};
```

---

## Server-Side User Resolution

### Getting the Effective User in API Routes

**File: `lib/impersonation-server.ts`**

```typescript
import { cookies } from 'next/headers';
import { createAuthenticatedServerClient } from './supabaseServer';

const IMPERSONATION_COOKIE_NAME = 'nf_impersonation';

export interface EffectiveUser {
  id: string;
  email: string;
  isImpersonated: boolean;
  realAdminId?: string;
}

/**
 * Gets the effective user ID for the current request.
 * If impersonation is active, returns the impersonated user.
 * Otherwise, returns the authenticated user.
 */
export async function getEffectiveUser(): Promise<EffectiveUser | null> {
  const supabase = await createAuthenticatedServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  // Check for impersonation cookie
  const cookieStore = await cookies();
  const impersonationCookie = cookieStore.get(IMPERSONATION_COOKIE_NAME);

  if (impersonationCookie) {
    try {
      const payload = JSON.parse(impersonationCookie.value);

      // Verify the cookie belongs to the current admin
      if (payload.adminUserId === user.id) {
        // Verify not expired
        if (new Date(payload.expiresAt) > new Date()) {
          return {
            id: payload.impersonatedUserId,
            email: payload.impersonatedEmail,
            isImpersonated: true,
            realAdminId: user.id,
          };
        }
      }
    } catch {
      // Invalid cookie - ignore
    }
  }

  // No impersonation - return actual user
  return {
    id: user.id,
    email: user.email || '',
    isImpersonated: false,
  };
}

/**
 * Use this in API routes that should respect impersonation.
 *
 * Example:
 * ```typescript
 * export async function GET() {
 *   const effectiveUser = await getEffectiveUser();
 *   if (!effectiveUser) return unauthorized();
 *
 *   // Query using effectiveUser.id
 *   const { data } = await supabase
 *     .from('agents')
 *     .select('*')
 *     .eq('user_id', effectiveUser.id);
 * }
 * ```
 */
```

### Updating Existing API Routes

API routes that should respect impersonation need to use `getEffectiveUser()` instead of `supabase.auth.getUser()` directly:

```typescript
// Before
export async function GET() {
  const supabase = await createAuthenticatedServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data } = await supabase
    .from('agents')
    .select('*')
    .eq('user_id', user.id);
}

// After
export async function GET() {
  const effectiveUser = await getEffectiveUser();
  if (!effectiveUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = await createAuthenticatedServerClient();
  const { data } = await supabase
    .from('agents')
    .select('*')
    .eq('user_id', effectiveUser.id);

  // Optional: Log action if impersonating
  if (effectiveUser.isImpersonated) {
    await logImpersonationAction(effectiveUser, 'viewed_agents', '/api/agents');
  }
}
```

---

## Audit Logging

### Action Logging During Impersonation

**File: `lib/impersonation-server.ts` (addition)**

```typescript
/**
 * Logs an action taken during impersonation
 */
export async function logImpersonationAction(
  effectiveUser: EffectiveUser,
  action: string,
  route: string,
  additionalDetails?: Record<string, unknown>
) {
  if (!effectiveUser.isImpersonated) {
    return; // Not impersonating, don't log
  }

  const supabaseAdmin = createClient(url, serviceRoleKey);

  // Get the active session ID
  const cookieStore = await cookies();
  const impersonationCookie = cookieStore.get(IMPERSONATION_COOKIE_NAME);
  const payload = JSON.parse(impersonationCookie!.value);

  await supabaseAdmin.from('audit_trail').insert({
    user_id: effectiveUser.realAdminId,
    action: 'impersonation_action',
    entity_type: 'impersonation',
    entity_id: payload.sessionId,
    details: {
      admin_user_id: effectiveUser.realAdminId,
      impersonated_user_id: effectiveUser.id,
      action_taken: action,
      route_accessed: route,
      ...additionalDetails,
    },
  });
}
```

### Key Actions to Log

Consider logging these significant actions during impersonation:

| Action | Route | Description |
|--------|-------|-------------|
| `viewed_dashboard` | `/dashboard` | Accessed main dashboard |
| `viewed_agents` | `/api/agents` | Listed user's agents |
| `viewed_agent_details` | `/api/agents/[id]` | Viewed specific agent |
| `executed_agent` | `/api/agent/run` | Ran an agent |
| `viewed_settings` | `/settings` | Accessed settings page |
| `modified_profile` | `/api/profile` | Changed profile data |

---

## Security Checklist

- [ ] Impersonation cookie is HTTP-only
- [ ] Impersonation cookie is Secure in production
- [ ] Cookie expiration enforced both client and server side
- [ ] Database session validated on every sensitive operation
- [ ] Admin role verified before starting impersonation
- [ ] Target user verified as non-admin
- [ ] Middleware blocks admin routes during impersonation
- [ ] All impersonation events logged to audit trail
- [ ] Cannot start new impersonation while one is active
- [ ] Session auto-expires after 4 hours
- [ ] Expired sessions properly cleaned up

---

## Testing Plan

### Unit Tests

1. `lib/impersonation.ts` - Cookie parsing/creation
2. `lib/impersonation-server.ts` - Effective user resolution

### Integration Tests

1. Start impersonation flow
   - Admin can start impersonation
   - Non-admin cannot start impersonation
   - Cannot impersonate another admin
   - Cannot start while session active

2. Active impersonation
   - Banner displays correctly
   - Admin routes blocked
   - Data queries use impersonated user ID
   - Actions logged to audit trail

3. End impersonation flow
   - Session ended correctly
   - Cookie cleared
   - Redirected back to admin
   - Duration logged

4. Session expiry
   - Cookie expires after 4 hours
   - Middleware redirects on expired cookie
   - DB session marked inactive

### Manual Testing Scenarios

1. **Happy Path**: Admin impersonates user, views dashboard, ends impersonation
2. **Access Control**: Try accessing `/admin/*` during impersonation (should fail)
3. **Expiry**: Wait for session to expire, verify redirect
4. **Multi-tab**: Open impersonation in multiple tabs, verify consistent state
5. **Browser Close**: Close browser, reopen, verify session persists (within 4 hours)

---

## Implementation Order

### Phase 1: Core Infrastructure
1. Create database migration for `impersonation_sessions` table
2. Create `lib/impersonation.ts` with types and utilities
3. Create `lib/impersonation-server.ts` with server helpers

### Phase 2: API Routes
4. Create `/api/admin/impersonate/start/route.ts`
5. Create `/api/admin/impersonate/end/route.ts`
6. Create `/api/admin/impersonate/status/route.ts`

### Phase 3: Middleware & Protection
7. Update `middleware.ts` to block admin routes during impersonation

### Phase 4: UI Components
8. Create `components/ImpersonationBanner.tsx`
9. Create `hooks/useImpersonation.ts`
10. Update `components/UserProvider.tsx` to include impersonation state

### Phase 5: Integration
11. Update `app/(protected)/layout.tsx` to include ImpersonationBanner
12. Update `app/admin/users/page.tsx` to add Impersonate button

### Phase 6: API Updates
13. Update key API routes to use `getEffectiveUser()`
14. Add audit logging for significant actions

### Phase 7: Testing & Polish
15. Write tests
16. Manual testing
17. Fix edge cases

---

## Future Enhancements (Out of Scope)

These are potential future improvements not included in the initial implementation:

1. **Impersonation reasons** - Require admins to provide a reason for impersonation
2. **Time-limited impersonation** - Allow admins to set shorter durations
3. **Impersonation history view** - Admin UI to view past impersonation sessions
4. **Notification to user** - Optional notification to user that they were impersonated
5. **Read-only mode** - Option to impersonate in read-only mode (no mutations)
6. **Global search entry point** - Search users from anywhere via command palette
7. **Impersonation request workflow** - Require approval for impersonating certain users

---

## Appendix: Full File List

### New Files
```
lib/impersonation.ts
lib/impersonation-server.ts
app/api/admin/impersonate/start/route.ts
app/api/admin/impersonate/end/route.ts
app/api/admin/impersonate/status/route.ts
components/ImpersonationBanner.tsx
hooks/useImpersonation.ts
supabase/migrations/YYYYMMDD_create_impersonation_sessions.sql
```

### Modified Files
```
middleware.ts
components/UserProvider.tsx
app/(protected)/layout.tsx
app/admin/users/page.tsx
```

### Optional Modifications (for full audit logging)
```
app/api/agents/route.ts
app/api/agents/[id]/route.ts
app/api/agent/run/route.ts
app/api/profile/route.ts
(and other user-facing API routes)
```
