// Check that UI uses Pilot Credits correctly, not raw LLM token counts
import * as fs from 'fs';
import * as path from 'path';

interface CheckResult {
  file: string;
  line: number;
  issue: string;
  severity: 'ok' | 'warning' | 'critical';
  context: string;
}

const results: CheckResult[] = [];

function checkFile(filePath: string) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    lines.forEach((line, index) => {
      const lineNum = index + 1;
      const trimmed = line.trim();

      // Pattern 1: Check for "tokens" being displayed without conversion to credits
      // Allow: tokens / 10, Math.ceil(tokens / 10), etc.
      // Flag: {tokens}, {tokenCount}, {total_tokens} without /10
      const tokenDisplayPattern = /\{[^}]*tokens[^}]*\}(?!.*\/\s*10)/i;
      if (tokenDisplayPattern.test(line) && !line.includes('// OK:') && !line.includes('tokensUsed')) {
        // Check if it's in a context where we're showing Pilot Credits
        if (!line.includes('Pilot Credit') && !line.includes('credits') && !line.includes('/ 10')) {
          results.push({
            file: filePath,
            line: lineNum,
            issue: 'Displaying raw token count without conversion to Pilot Credits',
            severity: 'warning',
            context: trimmed
          });
        }
      }

      // Pattern 2: Check for "LLM" references in user-facing text
      if (/['"`].*\bLLM\b.*['"`]/.test(line) && !line.includes('//')) {
        results.push({
          file: filePath,
          line: lineNum,
          issue: 'User-facing text mentions "LLM" - should use more user-friendly term',
          severity: 'warning',
          context: trimmed
        });
      }

      // Pattern 3: Verify Pilot Credits are calculated correctly (tokens / 10)
      if (line.includes('Pilot Credit') || line.includes('pilot credit')) {
        if (line.includes('/ 10') || line.includes('Math.ceil') && line.includes('/ 10')) {
          results.push({
            file: filePath,
            line: lineNum,
            issue: 'Correctly converts tokens to Pilot Credits (÷ 10)',
            severity: 'ok',
            context: trimmed
          });
        } else if (line.includes('pilot_credits') || line.includes('pilotCredits')) {
          // Using variable that's already credits - OK
          results.push({
            file: filePath,
            line: lineNum,
            issue: 'Using Pilot Credits variable correctly',
            severity: 'ok',
            context: trimmed
          });
        }
      }

      // Pattern 4: Check for proper credit conversion in calculations
      if (line.includes('Math.ceil') && line.includes('/ 10')) {
        if (line.includes('token') && line.includes('credit')) {
          results.push({
            file: filePath,
            line: lineNum,
            issue: 'Correctly converts tokens to credits',
            severity: 'ok',
            context: trimmed
          });
        }
      }
    });

  } catch (error) {
    // Ignore files that can't be read
  }
}

function findUIFiles(dir: string, files: string[] = []): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      // Skip node_modules, .next, etc.
      if (!entry.name.startsWith('.') && entry.name !== 'node_modules') {
        findUIFiles(fullPath, files);
      }
    } else if (entry.isFile()) {
      // Only check UI files
      if (entry.name.endsWith('.tsx') || entry.name.endsWith('.jsx')) {
        files.push(fullPath);
      }
    }
  }

  return files;
}

function printResults() {
  console.log('\n' + '='.repeat(80));
  console.log('🎨 UI PILOT CREDIT USAGE CHECK');
  console.log('='.repeat(80) + '\n');

  // Group by file
  const fileGroups = new Map<string, CheckResult[]>();
  results.forEach(r => {
    const key = r.file;
    if (!fileGroups.has(key)) {
      fileGroups.set(key, []);
    }
    fileGroups.get(key)!.push(r);
  });

  const criticalCount = results.filter(r => r.severity === 'critical').length;
  const warningCount = results.filter(r => r.severity === 'warning').length;
  const okCount = results.filter(r => r.severity === 'ok').length;

  // Print warnings and criticals
  console.log('⚠️  WARNINGS & ISSUES:\n');
  let hasIssues = false;

  fileGroups.forEach((fileResults, file) => {
    const issues = fileResults.filter(r => r.severity !== 'ok');
    if (issues.length > 0) {
      hasIssues = true;
      console.log(`\n📄 ${file.replace(process.cwd(), '')}`);
      issues.forEach(r => {
        const icon = r.severity === 'critical' ? '❌' : '⚠️';
        console.log(`  ${icon} Line ${r.line}: ${r.issue}`);
        console.log(`     ${r.context.substring(0, 100)}...`);
      });
    }
  });

  if (!hasIssues) {
    console.log('  ✅ No issues found!\n');
  }

  // Print summary of correct usage
  console.log('\n✅ CORRECT USAGE FOUND:\n');

  const correctFiles = new Set<string>();
  results.filter(r => r.severity === 'ok').forEach(r => {
    correctFiles.add(r.file);
  });

  correctFiles.forEach(file => {
    const fileResults = fileGroups.get(file)?.filter(r => r.severity === 'ok') || [];
    console.log(`\n📄 ${file.replace(process.cwd(), '')}`);
    console.log(`   ${fileResults.length} correct Pilot Credit usage(s)`);
  });

  console.log('\n' + '='.repeat(80));
  console.log('\n📊 SUMMARY:\n');
  console.log(`  ✅ Correct usage: ${okCount}`);
  console.log(`  ⚠️  Warnings: ${warningCount}`);
  console.log(`  ❌ Critical issues: ${criticalCount}`);

  console.log('\n' + '='.repeat(80));

  if (criticalCount === 0 && warningCount === 0) {
    console.log('\n🎉 UI correctly uses Pilot Credits everywhere!\n');
    process.exit(0);
  } else if (criticalCount === 0) {
    console.log(`\n⚠️  UI has ${warningCount} minor warnings to review.\n`);
    process.exit(0);
  } else {
    console.log(`\n❌ UI has ${criticalCount} critical issues that need fixing.\n`);
    process.exit(1);
  }
}

function main() {
  console.log('\n🔍 Scanning UI files for Pilot Credit usage...\n');

  const uiDirs = [
    'app/(protected)/agents',
    'components/agents',
    'components/settings',
    'components/billing',
  ];

  let totalFiles = 0;
  for (const dir of uiDirs) {
    const fullDir = path.join(process.cwd(), dir);
    if (fs.existsSync(fullDir)) {
      const files = findUIFiles(fullDir);
      console.log(`  📁 ${dir}: ${files.length} files`);
      files.forEach(file => {
        checkFile(file);
        totalFiles++;
      });
    }
  }

  console.log(`\n✅ Scanned ${totalFiles} UI files\n`);

  printResults();
}

main();
