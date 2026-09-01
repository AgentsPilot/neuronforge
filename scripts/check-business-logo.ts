/**
 * Where does each business's logo stand?
 *
 * Reports whether the migration has been applied, what each profile holds, and
 * which website headers are set to show it — the three things that have to
 * agree for a logo to appear on invoices, emails, booking pages and the site.
 *
 *   npx tsx -r dotenv/config scripts/check-business-logo.ts dotenv_config_path=.env.local
 */

import { supabaseServer } from '../lib/supabaseServer';

async function main() {
  const { data: profiles, error } = await supabaseServer
    .from('business_profiles')
    .select('user_id, company_name, logo_url, show_logo_on_smart_links');

  if (error) {
    if (error.code === '42703') {
      console.log('MIGRATION NOT APPLIED — business_profiles has no logo_url column.');
      console.log('Run supabase/migrations/20260827_business_logo_single_source.sql first.');
      return;
    }
    throw error;
  }

  console.log('=== business profiles ===');
  console.table(
    (profiles || []).map(p => ({
      user: p.user_id.slice(0, 8),
      company: p.company_name,
      logo: p.logo_url ? `${String(p.logo_url).slice(0, 48)}…` : '(none)',
      smart_links: p.show_logo_on_smart_links,
    }))
  );

  const { data: pages } = await supabaseServer
    .from('website_pages')
    .select('id, user_id, subdomain, status');

  console.log('\n=== website headers ===');
  const rows: Array<Record<string, unknown>> = [];
  for (const page of pages || []) {
    const { data: blocks } = await supabaseServer
      .from('website_blocks')
      .select('content')
      .eq('page_id', page.id)
      .eq('block_type', 'header');

    for (const block of blocks || []) {
      const content = (block.content || {}) as Record<string, unknown>;
      const profile = (profiles || []).find(p => p.user_id === page.user_id);
      rows.push({
        page: page.subdomain || page.id.slice(0, 8),
        status: page.status,
        show_logo: content.show_logo ?? '(unset)',
        // What the header used to carry itself. Left in place by the migration
        // so it can be rolled back; nothing reads it any more.
        legacy_logo_url: content.logo_url ? 'present' : '—',
        will_render: content.show_logo === true && !!profile?.logo_url,
      });
    }
  }
  console.table(rows);

  const unset = rows.filter(r => r.show_logo === '(unset)').length;
  if (unset > 0) {
    console.log(`\n${unset} header(s) have no show_logo — the migration's block pass has not run.`);
  }
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
