#!/usr/bin/env node
/**
 * Validate the env Gmail OAuth2 credentials used by the email transport
 * (the contact-form / notification Gmail — NOT the google-mail plugin's
 * per-user connection). Directly exchanges the refresh token for an access
 * token against Google's token endpoint and reports the exact result.
 *
 * This is the same refresh nodemailer does internally, so it pinpoints why
 * notification emails fail (e.g. `invalid_grant` = revoked/expired/mismatched
 * refresh token; `invalid_client` = wrong client id/secret).
 *
 * No deps (Node 18+ global fetch). Run from project root:
 *   node scripts/validate-gmail.mjs
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function readEnvLocal() {
  let raw = '';
  try { raw = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8'); } catch { return {}; }
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    env[m[1]] = v;
  }
  return env;
}

const mask = (s) => !s ? '(none)' : (s.length <= 10 ? s.slice(0, 3) + '…' : s.slice(0, 8) + '…' + s.slice(-4));

async function main() {
  console.log('\n🔍 Validating env Gmail OAuth2 (notification/contact-form transport)\n');
  const env = readEnvLocal();
  const clientId = process.env.GMAIL_CLIENT_ID || env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET || env.GMAIL_CLIENT_SECRET;
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN || env.GMAIL_REFRESH_TOKEN;
  const user = process.env.GMAIL_USER || env.GMAIL_USER;

  console.log(`GMAIL_USER:          ${user || '(none)'}`);
  console.log(`GMAIL_CLIENT_ID:     ${mask(clientId)}  ${clientId?.endsWith('.apps.googleusercontent.com') ? '(looks like a Google client id)' : '⚠️ does not look like a Google client id'}`);
  console.log(`GMAIL_CLIENT_SECRET: ${mask(clientSecret)}`);
  console.log(`GMAIL_REFRESH_TOKEN: ${mask(refreshToken)}`);

  // For comparison — the app's main Google OAuth client (the plugin uses this family)
  const googleClientId = process.env.GOOGLE_CLIENT_ID || env.GOOGLE_CLIENT_ID;
  if (googleClientId && clientId && googleClientId !== clientId) {
    console.log(`\nℹ️  Note: GMAIL_CLIENT_ID differs from GOOGLE_CLIENT_ID (${mask(googleClientId)}).`);
    console.log(`   A refresh token only works with the SAME client it was issued for — a mismatch causes invalid_grant.`);
  }

  if (!clientId || !clientSecret || !refreshToken) {
    console.log('\n❌ Missing one of GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET / GMAIL_REFRESH_TOKEN.\n');
    process.exit(1);
  }

  console.log('\n→ Exchanging refresh token for an access token (oauth2.googleapis.com/token)...\n');
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });

  let res;
  try {
    res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
  } catch (e) {
    console.log(`❌ Network error reaching Google: ${e.message}\n`);
    process.exit(1);
  }

  const data = await res.json().catch(() => ({}));

  if (res.ok && data.access_token) {
    console.log('✅ SUCCESS — the env Gmail credentials are VALID.');
    console.log(`   Got an access token (expires in ${data.expires_in}s). Notification emails via Gmail should work.`);
    console.log('   If notifications still fail, the problem is elsewhere (not these credentials).\n');
    return;
  }

  console.log(`❌ FAILED (${res.status}): ${data.error || 'unknown'} — ${data.error_description || JSON.stringify(data)}`);
  console.log('\nWhat this means:');
  if (data.error === 'invalid_grant') {
    console.log('   The REFRESH TOKEN is no longer usable. Most common causes:');
    console.log('   • The OAuth consent screen is in "Testing" mode → refresh tokens expire after 7 days.');
    console.log('   • The token was revoked (account security, password change, or re-consent).');
    console.log('   • The token was issued for a DIFFERENT client_id than GMAIL_CLIENT_ID.');
    console.log('   → Fix: regenerate GMAIL_REFRESH_TOKEN for THIS client_id (and publish the OAuth app to avoid 7-day expiry).');
  } else if (data.error === 'invalid_client') {
    console.log('   GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET are wrong or mismatched.');
  } else if (data.error === 'unauthorized_client') {
    console.log('   This client is not authorized for the refresh_token grant / scopes.');
  }
  console.log('\n   (Note: this is separate from your google-mail PLUGIN connection, which uses a different per-user token — that one clearly works since your agent emails sent.)\n');
  process.exit(1);
}

main().catch((e) => { console.error('Unexpected error:', e); process.exit(1); });
