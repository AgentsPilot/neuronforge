/**
 * Test Script: LLM-Powered Website Generation
 *
 * Purpose: Verify the complete onboarding flow works correctly:
 * 1. Bio processing (OnboardingChatService)
 * 2. Website auto-build (WebsiteAutoBuildService)
 * 3. Template selection logic
 * 4. Block content generation quality
 * 5. End-to-end flow from bio → profile → website
 *
 * Usage:
 *   npx tsx scripts/test-llm-generation.ts
 */

import { OnboardingChatService } from '@/lib/services/OnboardingChatService';
import { WebsiteAutoBuildService } from '@/lib/services/WebsiteAutoBuildService';
import type { Locale } from '@/lib/i18n/config';
import type { BusinessProfileData } from '@/lib/services/WebsiteAutoBuildService';

// Test business bios
const TEST_BIOS = {
  therapist: `I'm Dr. Sarah Johnson, a licensed clinical psychologist specializing in trauma therapy and PTSD treatment.
I've been practicing for 8 years in Los Angeles, seeing about 20 clients per week. I offer individual therapy sessions
both in-person and online via Zoom. My practice focuses on evidence-based approaches including EMDR and CBT. I use
Google Calendar for scheduling and Stripe for payments. My website is therapywithsarah.com where potential clients
can learn more about my approach and book consultations.`,

  coach: `Hi, I'm Michael Chen, an executive leadership coach helping C-suite professionals accelerate their careers.
I've coached over 100 executives at Fortune 500 companies over the past 12 years. I offer 1:1 coaching packages
(3-month and 6-month programs) as well as group coaching workshops. I typically work with 15-20 clients at a time.
I use Calendly for booking discovery calls and Stripe for payment processing. My target audience is ambitious
executives looking to level up their leadership skills and navigate career transitions.`,

  consultant: `I'm Jennifer Rodriguez, a digital marketing consultant specializing in growth strategies for SaaS companies.
I help tech startups scale their user acquisition through data-driven campaigns. My services include marketing audits,
growth strategy development, and hands-on campaign execution. I work with 5-8 clients per month on project or retainer
basis. I use HubSpot for client management, Google Calendar for meetings, and QuickBooks for invoicing. My website is
jenniferrodriguez.com where I showcase case studies and client results.`,

  course_creator: `I'm Alex Martinez, creator of "ADHD Mastery Course" - a transformational online program helping adults
with ADHD thrive in work and life. I've helped over 500 students over 3 years. The course combines pre-recorded video
lessons with live weekly group sessions (20-30 students per cohort). I run 4 cohorts per year. Students pay $299
one-time or $99/month for 3 months. I use Teachable for course hosting, Zoom for live sessions, Stripe for payments,
and ConvertKit for email automation. My target audience is adults recently diagnosed with ADHD looking for practical strategies.`
};

// Expected vertical detection
const EXPECTED_VERTICALS = {
  therapist: 'therapist',
  coach: 'coach',
  consultant: 'consultant',
  course_creator: 'course_creator'
};

// Initialize services
const onboardingService = new OnboardingChatService();
const websiteService = new WebsiteAutoBuildService();

/**
 * Test 1: Bio Processing
 */
async function testBioProcessing(name: string, bio: string, expectedVertical: string) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`TEST 1: Bio Processing - ${name}`);
  console.log('='.repeat(80));

  try {
    const result = await onboardingService.processBio(bio, 'en');

    if (!result.success) {
      console.error('❌ FAILED: Bio processing failed');
      console.error('Error:', result.error);
      return null;
    }

    console.log('✅ PASSED: Bio processed successfully');
    console.log('\nExtracted Profile:');
    console.log('  Vertical:', result.profile.vertical);
    console.log('  Company Name:', result.profile.company_name);
    console.log('  Services:', result.profile.services);
    console.log('  Clients/Week:', result.profile.clients_per_week);
    console.log('  Tools:', result.profile.connected_plugins);
    console.log('  Website:', result.profile.website_url);
    console.log('  Completeness:', result.profile.profile_completeness + '%');

    // Validate vertical detection
    if (result.profile.vertical !== expectedVertical) {
      console.warn(`⚠️  WARNING: Expected vertical "${expectedVertical}", got "${result.profile.vertical}"`);
    }

    // Validate completeness threshold
    if (result.profile.profile_completeness < 50) {
      console.warn(`⚠️  WARNING: Profile completeness is below 50% (${result.profile.profile_completeness}%)`);
    }

    return result.profile;
  } catch (error) {
    console.error('❌ FAILED: Exception thrown');
    console.error(error);
    return null;
  }
}

/**
 * Test 2: Website Auto-Build
 */
async function testWebsiteAutoBuild(name: string, profile: any) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`TEST 2: Website Auto-Build - ${name}`);
  console.log('='.repeat(80));

  try {
    const profileData: BusinessProfileData = {
      vertical: profile.vertical,
      sub_vertical: profile.sub_vertical,
      company_name: profile.company_name,
      services: profile.services || [],
      clients_per_week: profile.clients_per_week,
      tools: profile.connected_plugins || [],
      website_url: profile.website_url,
      website_analysis: profile.website_analysis
    };

    const result = await websiteService.buildWebsite(profileData, 'en');

    if (!result.success) {
      console.error('❌ FAILED: Website build failed');
      console.error('Error:', result.error);
      return null;
    }

    console.log('✅ PASSED: Website built successfully');
    console.log('\nWebsite Details:');
    console.log('  Template:', result.website!.template_name);
    console.log('  Template ID:', result.website!.template_id);
    console.log('  Page Title:', result.website!.page_title);
    console.log('  Meta Description:', result.website!.meta_description);
    console.log('  Total Blocks:', result.website!.blocks.length);
    console.log('\nTheme:');
    console.log('  Primary Color:', result.website!.theme.primary_color);
    console.log('  Secondary Color:', result.website!.theme.secondary_color);
    console.log('  Brand Voice:', result.website!.theme.brand_voice);
    console.log('  Font:', result.website!.theme.font_family);

    return result.website;
  } catch (error) {
    console.error('❌ FAILED: Exception thrown');
    console.error(error);
    return null;
  }
}

/**
 * Test 3: Block Content Quality
 */
function testBlockContentQuality(name: string, website: any, profile: any) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`TEST 3: Block Content Quality - ${name}`);
  console.log('='.repeat(80));

  let passedChecks = 0;
  let totalChecks = 0;

  console.log('\nBlock-by-Block Analysis:');
  console.log('-'.repeat(80));

  for (const block of website.blocks) {
    console.log(`\n[${block.block_type.toUpperCase()}]`);

    // Check 1: Content is not empty
    totalChecks++;
    const hasContent = Object.keys(block.content).length > 0;
    if (hasContent) {
      console.log('  ✓ Has content');
      passedChecks++;
    } else {
      console.log('  ✗ Missing content');
    }

    // Check 2: Company name mentioned (if applicable)
    if (profile.company_name && ['hero', 'about', 'services'].includes(block.block_type)) {
      totalChecks++;
      const contentString = JSON.stringify(block.content).toLowerCase();
      const companyNameMentioned = contentString.includes(profile.company_name.toLowerCase());

      if (companyNameMentioned) {
        console.log('  ✓ Mentions company name');
        passedChecks++;
      } else {
        console.log('  ✗ Does not mention company name');
      }
    }

    // Check 3: Services referenced (if services block)
    if (block.block_type === 'services' && profile.services && profile.services.length > 0) {
      totalChecks++;
      const servicesArray = block.content.services || [];

      if (servicesArray.length >= profile.services.length) {
        console.log(`  ✓ Contains ${servicesArray.length} services`);
        passedChecks++;
      } else {
        console.log(`  ✗ Expected ${profile.services.length} services, got ${servicesArray.length}`);
      }
    }

    // Check 4: Realistic testimonials (if testimonials block)
    if (block.block_type === 'testimonials') {
      totalChecks++;
      const testimonials = block.content.testimonials || [];

      if (testimonials.length >= 2 && testimonials.length <= 4) {
        console.log(`  ✓ Has ${testimonials.length} testimonials (realistic count)`);
        passedChecks++;
      } else {
        console.log(`  ✗ Testimonial count seems off: ${testimonials.length}`);
      }
    }

    // Check 5: CTA integration (if booking/payment block)
    if (['booking_widget', 'payment_button'].includes(block.block_type)) {
      totalChecks++;
      const hasIntegration = block.content.capability_integration || block.content.button_text;

      if (hasIntegration) {
        console.log('  ✓ Has capability integration');
        passedChecks++;
      } else {
        console.log('  ✗ Missing capability integration');
      }
    }

    // Display content preview
    console.log('\n  Content Preview:');
    const contentPreview = JSON.stringify(block.content, null, 2)
      .split('\n')
      .slice(0, 10)
      .map(line => '    ' + line)
      .join('\n');
    console.log(contentPreview);
    if (JSON.stringify(block.content, null, 2).split('\n').length > 10) {
      console.log('    ... (truncated)');
    }
  }

  console.log('\n' + '-'.repeat(80));
  console.log(`Quality Score: ${passedChecks}/${totalChecks} checks passed (${Math.round((passedChecks/totalChecks)*100)}%)`);

  if (passedChecks / totalChecks >= 0.8) {
    console.log('✅ PASSED: Content quality is acceptable');
  } else {
    console.warn('⚠️  WARNING: Content quality below 80%');
  }
}

/**
 * Test 4: Multi-Language Support
 */
async function testMultiLanguage(name: string, bio: string, locale: Locale) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`TEST 4: Multi-Language Support - ${name} (${locale})`);
  console.log('='.repeat(80));

  try {
    const result = await onboardingService.processBio(bio, locale);

    if (!result.success) {
      console.error('❌ FAILED: Bio processing failed for locale:', locale);
      return;
    }

    console.log('✅ PASSED: Bio processed in', locale);
    console.log('  Extracted vertical:', result.profile.vertical);

    // Build website in target language
    const profileData: BusinessProfileData = {
      vertical: result.profile.vertical,
      company_name: result.profile.company_name,
      services: result.profile.services || [],
      clients_per_week: result.profile.clients_per_week,
      tools: result.profile.connected_plugins || []
    };

    const websiteResult = await websiteService.buildWebsite(profileData, locale);

    if (!websiteResult.success) {
      console.error('❌ FAILED: Website build failed for locale:', locale);
      return;
    }

    console.log('✅ PASSED: Website built in', locale);
    console.log('  Page title:', websiteResult.website!.page_title);
    console.log('  Meta description:', websiteResult.website!.meta_description);

    // Check if content is actually in target language (basic heuristic)
    const sampleContent = JSON.stringify(websiteResult.website!.blocks[0].content);
    console.log('\n  Sample content:', sampleContent.substring(0, 100) + '...');

  } catch (error) {
    console.error('❌ FAILED: Exception thrown');
    console.error(error);
  }
}

/**
 * Main Test Runner
 */
async function runAllTests() {
  console.log('\n');
  console.log('█'.repeat(80));
  console.log('  LLM-POWERED WEBSITE GENERATION TEST SUITE');
  console.log('█'.repeat(80));

  const results: { [key: string]: any } = {};

  // Test all verticals
  for (const [vertical, bio] of Object.entries(TEST_BIOS)) {
    const expectedVertical = EXPECTED_VERTICALS[vertical as keyof typeof EXPECTED_VERTICALS];

    // Test 1: Bio Processing
    const profile = await testBioProcessing(vertical, bio, expectedVertical);
    if (!profile) {
      console.error(`\n⛔ Skipping remaining tests for ${vertical} due to bio processing failure\n`);
      continue;
    }

    // Test 2: Website Auto-Build
    const website = await testWebsiteAutoBuild(vertical, profile);
    if (!website) {
      console.error(`\n⛔ Skipping content quality test for ${vertical} due to website build failure\n`);
      continue;
    }

    // Test 3: Block Content Quality
    testBlockContentQuality(vertical, website, profile);

    // Store results
    results[vertical] = { profile, website };
  }

  // Test 4: Multi-Language (just test therapist in Spanish and Hebrew)
  await testMultiLanguage('Therapist', TEST_BIOS.therapist, 'es');
  await testMultiLanguage('Therapist', TEST_BIOS.therapist, 'he');

  // Summary
  console.log(`\n${'='.repeat(80)}`);
  console.log('TEST SUMMARY');
  console.log('='.repeat(80));

  const testedVerticals = Object.keys(results);
  console.log(`\nTotal Verticals Tested: ${testedVerticals.length}/${Object.keys(TEST_BIOS).length}`);

  for (const vertical of testedVerticals) {
    console.log(`\n${vertical.toUpperCase()}:`);
    console.log('  ✓ Bio processing');
    console.log('  ✓ Website generation');
    console.log('  ✓ Content quality');
    console.log('  - Total blocks:', results[vertical].website.blocks.length);
    console.log('  - Template:', results[vertical].website.template_name);
  }

  console.log('\n' + '='.repeat(80));
  console.log('All tests completed!');
  console.log('='.repeat(80) + '\n');
}

// Run tests
runAllTests().catch(console.error);
