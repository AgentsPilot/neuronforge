#!/usr/bin/env node
/**
 * Validate the Resend email setup for the calibration notification path.
 *
 * Reads RESEND_API_KEY (and optional RESEND_FROM_EMAIL) from .env.local, then:
 *   1. Confirms the key is present and well-formed.
 *   2. Calls the Resend API to confirm the key is valid (auth check).
 *   3. Lists your verified sending domains.
 *   4. Tells you which `from` address will actually deliver — specifically
 *      whether `notifications@neuronforge.app` (the app default) is usable.
 *   5. Optionally sends a real test email:  node scripts/validate-resend.mjs --to you@example.com
 *
 * No dependencies — uses Node 18+ global fetch. Run from the project root:
 *   node scripts/validate-resend.mjs
 *   node scripts/validate-resend.mjs --to you@example.com
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const APP_DEFAULT_FROM = 'NeuronForge <notifications@neuronforge.app>';
const APP_DEFAULT_DOMAIN = 'neuronforge.app';
const SANDBOX_FROM = 'onboarding@resend.dev';

function readEnvLocal() {
  const path = resolve(process.cwd(), '.env.local');
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return {};
  }
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m) continue;
    let val = m[2].trim();
    // strip surrounding quotes
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    env[m[1]] = val;
  }
  return env;
}

function mask(key) {
  if (!key) return '(none)';
  return key.length <= 10 ? key.slice(0, 3) + '…' : key.slice(0, 6) + '…' + key.slice(-3);
}

function getArg(name) {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  console.log('\n🔍 Validating Resend setup (calibration notification email)\n');

  const env = readEnvLocal();
  const key = process.env.RESEND_API_KEY || env.RESEND_API_KEY;
  const fromOverride = process.env.RESEND_FROM_EMAIL || env.RESEND_FROM_EMAIL;

  // 1. Key present?
  if (!key) {
    console.log('❌ RESEND_API_KEY is NOT set in .env.local (or the environment).');
    console.log('   → Add a line:  RESEND_API_KEY=re_your_key_here');
    console.log('   → Get a key at https://resend.com → API Keys\n');
    process.exit(1);
  }
  console.log(`✓ RESEND_API_KEY found: ${mask(key)}`);
  if (!key.startsWith('re_')) {
    console.log('⚠️  Warning: Resend keys normally start with "re_". This may be wrong.');
  }
  if (fromOverride) {
    console.log(`✓ RESEND_FROM_EMAIL override: ${fromOverride}`);
  }

  // 2 + 3. Auth check + list domains
  console.log('\n→ Checking key validity and verified domains...\n');
  let res;
  try {
    res = await fetch('https://api.resend.com/domains', {
      headers: { Authorization: `Bearer ${key}` },
    });
  } catch (e) {
    console.log(`❌ Could not reach the Resend API: ${e.message}`);
    process.exit(1);
  }

  if (res.status === 401) {
    console.log('❌ The key is INVALID (401 Unauthorized). Double-check you copied the full key.\n');
    process.exit(1);
  }
  if (!res.ok) {
    console.log(`❌ Unexpected Resend API response: ${res.status} ${await res.text()}`);
    process.exit(1);
  }

  console.log('✓ Key is valid (authenticated).');

  const body = await res.json();
  const domains = body?.data || [];
  const verified = domains.filter((d) => d.status === 'verified');

  console.log(`\n📂 Domains on this Resend account: ${domains.length}`);
  for (const d of domains) {
    const flag = d.status === 'verified' ? '✓' : '…';
    console.log(`   ${flag} ${d.name}  [${d.status}]`);
  }

  const appDomainVerified = verified.some((d) => d.name === APP_DEFAULT_DOMAIN);

  // 4. Recommendation
  console.log('\n────────────────────────────────────────');
  console.log('RECOMMENDATION');
  console.log('────────────────────────────────────────');
  if (appDomainVerified) {
    console.log(`✅ "${APP_DEFAULT_DOMAIN}" is VERIFIED — the app default works as-is.`);
    console.log(`   Use:  RESEND_API_KEY=<your key>   (no RESEND_FROM_EMAIL needed)`);
    console.log(`   Default sender: ${APP_DEFAULT_FROM}`);
  } else if (verified.length > 0) {
    const d = verified[0].name;
    console.log(`⚠️  "${APP_DEFAULT_DOMAIN}" is NOT verified, but "${d}" IS.`);
    console.log(`   The app default (${APP_DEFAULT_FROM}) will FAIL.`);
    console.log(`   → Either verify ${APP_DEFAULT_DOMAIN} in Resend, or send from @${d}`);
    console.log(`     (requires the RESEND_FROM_EMAIL override — ask to wire it in).`);
  } else {
    console.log(`⚠️  No verified domains. The app default (${APP_DEFAULT_FROM}) will FAIL.`);
    console.log(`   For local testing use the sandbox sender:`);
    console.log(`     ${SANDBOX_FROM}   (delivers ONLY to your Resend account email)`);
    console.log(`   This needs the RESEND_FROM_EMAIL override wired in — ask to add it.`);
  }

  // 5. Optional test send
  const to = getArg('--to');
  if (to) {
    const from = fromOverride || APP_DEFAULT_FROM;
    console.log(`\n→ Sending a test email from "${from}" to "${to}"...`);
    const sendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [to],
        subject: 'Resend validation test (NeuronForge)',
        html: '<p>✅ Your Resend setup works — calibration notification emails will deliver.</p>',
      }),
    });
    const sendBody = await sendRes.json().catch(() => ({}));
    if (sendRes.ok) {
      console.log(`✅ Test email accepted by Resend (id: ${sendBody.id}). Check your inbox.`);
    } else {
      console.log(`❌ Test send FAILED (${sendRes.status}): ${sendBody?.message || JSON.stringify(sendBody)}`);
      if (/domain is not verified|not verified/i.test(JSON.stringify(sendBody))) {
        console.log(`   → This confirms the "from" domain isn't verified. Use ${SANDBOX_FROM} or verify the domain.`);
      }
    }
  } else {
    console.log(`\nℹ️  To actually send a test email:  node scripts/validate-resend.mjs --to you@example.com`);
  }

  console.log('');
}

main().catch((e) => {
  console.error('Unexpected error:', e);
  process.exit(1);
});
