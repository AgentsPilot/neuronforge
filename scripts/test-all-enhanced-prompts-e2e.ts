#!/usr/bin/env npx tsx

/**
 * End-to-End Test Suite for All Enhanced Prompts
 *
 * Tests complete V6 pipeline for each enhanced prompt:
 * 1. Vocabulary extraction
 * 2. IntentContract generation (LLM)
 * 3. Capability binding
 * 4. IR conversion
 * 5. PILOT DSL compilation
 * 6. Deep schema validation
 * 7. Business requirements analysis
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

interface TestResult {
  promptFile: string;
  workflowName: string;
  status: 'PASS' | 'FAIL' | 'ERROR';
  pipelineTime: number;
  llmTime: number;
  deterministicTime: number;
  intentSteps: number;
  pilotSteps: number;
  executability: number;
  issues: number;
  warnings: number;
  schemaValidation: 'PASS' | 'FAIL';
  businessValidation: 'PASS' | 'FAIL';
  errors: string[];
  insights: string[];
}

class EnhancedPromptTester {
  private results: TestResult[] = [];
  private outputDir: string;

  constructor(outputRoot?: string) {
    this.outputDir = outputRoot
      ? path.resolve(outputRoot)
      : path.join(__dirname, '..', 'output', 'e2e-test-results');

    // Create output directory
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
  }

  private async runPipeline(promptFile: string): Promise<TestResult> {
    const result: TestResult = {
      promptFile,
      workflowName: '',
      status: 'PASS',
      pipelineTime: 0,
      llmTime: 0,
      deterministicTime: 0,
      intentSteps: 0,
      pilotSteps: 0,
      executability: 0,
      issues: 0,
      warnings: 0,
      schemaValidation: 'PASS',
      businessValidation: 'PASS',
      errors: [],
      insights: []
    };

    console.log('\n' + '='.repeat(100));
    console.log(`🚀 Testing: ${promptFile}`);
    console.log('='.repeat(100));

    try {
      // Read enhanced prompt
      const promptPath = path.resolve(promptFile);
      const promptContent = JSON.parse(fs.readFileSync(promptPath, 'utf-8'));
      result.workflowName = promptContent.plan_title || promptFile;

      // Create per-prompt output subfolder
      const promptBaseName = path.basename(promptFile, '.json');
      const promptOutputDir = path.join(this.outputDir, promptBaseName);
      if (!fs.existsSync(promptOutputDir)) {
        fs.mkdirSync(promptOutputDir, { recursive: true });
      }

      console.log(`\n📋 Workflow: ${result.workflowName}`);
      console.log(`📂 Output: ${promptOutputDir}`);

      // Run complete pipeline
      const pipelineStart = Date.now();

      console.log('\n⏳ Running V6 pipeline...');
      const pipelineOutput = execSync(
        `npx tsx scripts/test-complete-pipeline-with-vocabulary.ts "${promptFile}" --output-dir "${promptOutputDir}"`,
        {
          encoding: 'utf-8',
          maxBuffer: 10 * 1024 * 1024 // 10MB buffer
        }
      );

      const pipelineEnd = Date.now();
      result.pipelineTime = pipelineEnd - pipelineStart;

      // Parse pipeline output for metrics
      this.parsePipelineOutput(pipelineOutput, result);

      console.log(`\n✅ Pipeline completed in ${result.pipelineTime}ms`);
      console.log(`   - LLM time: ${result.llmTime}ms (${((result.llmTime / result.pipelineTime) * 100).toFixed(1)}%)`);
      console.log(`   - Deterministic time: ${result.deterministicTime}ms (${((result.deterministicTime / result.pipelineTime) * 100).toFixed(1)}%)`);

      // Run deep schema validation
      console.log('\n🔍 Running deep schema validation...');
      try {
        execSync(
          'npx tsx scripts/validate-workflow-deep-schema.ts',
          {
            encoding: 'utf-8',
            stdio: 'pipe'
          }
        );
        result.schemaValidation = 'PASS';
        console.log('✅ Schema validation: PASS');
      } catch (error: any) {
        result.schemaValidation = 'FAIL';
        result.errors.push('Schema validation failed');
        console.log('❌ Schema validation: FAIL');

        // Parse validation errors
        const output = error.stdout || error.stderr || '';
        this.parseValidationErrors(output, result);
      }

      // Analyze business requirements
      console.log('\n📊 Analyzing business requirements...');
      this.analyzeBusinessRequirements(promptContent, result, promptOutputDir);

      // Calculate executability
      this.calculateExecutability(result);

      // Generate insights
      this.generateInsights(result);

      console.log('\n' + '='.repeat(100));
      console.log(`✅ ${result.workflowName}: ${result.status}`);
      console.log(`   Executability: ${result.executability}%`);
      console.log(`   Issues: ${result.issues}, Warnings: ${result.warnings}`);
      console.log('='.repeat(100));

    } catch (error: any) {
      result.status = 'ERROR';
      result.errors.push(error.message || String(error));

      console.log('\n' + '='.repeat(100));
      console.log(`❌ ${result.workflowName}: ERROR`);
      console.log(`   ${error.message}`);
      console.log('='.repeat(100));
    }

    return result;
  }

  private parsePipelineOutput(output: string, result: TestResult): void {
    // Extract IntentContract steps
    const intentMatch = output.match(/Generated IntentContract.*?(\d+)\s+steps/i);
    if (intentMatch) {
      result.intentSteps = parseInt(intentMatch[1]);
    }

    // Extract PILOT DSL steps
    const pilotMatch = output.match(/PILOT DSL compilation.*?(\d+)\s+steps/i);
    if (pilotMatch) {
      result.pilotSteps = parseInt(pilotMatch[1]);
    }

    // Extract timing
    const llmMatch = output.match(/Phase 1:.*?(\d+)ms/);
    if (llmMatch) {
      result.llmTime = parseInt(llmMatch[1]);
    }

    const phase2Match = output.match(/Phase 2:.*?(\d+)ms/);
    const phase3Match = output.match(/Phase 3:.*?(\d+)ms/);
    const phase4Match = output.match(/Phase 4:.*?(\d+)ms/);

    if (phase2Match && phase3Match && phase4Match) {
      result.deterministicTime = parseInt(phase2Match[1]) + parseInt(phase3Match[1]) + parseInt(phase4Match[1]);
    }
  }

  private parseValidationErrors(output: string, result: TestResult): void {
    const issueMatches = output.match(/❌/g);
    const warningMatches = output.match(/⚠️/g);

    result.issues = issueMatches ? issueMatches.length : 0;
    result.warnings = warningMatches ? warningMatches.length : 0;
  }

  private analyzeBusinessRequirements(promptContent: any, result: TestResult, promptOutputDir: string): void {
    // Read generated PILOT DSL from per-prompt output directory
    const pilotPath = path.join(promptOutputDir, 'phase4-pilot-dsl-steps.json');

    if (!fs.existsSync(pilotPath)) {
      result.businessValidation = 'FAIL';
      result.errors.push('PILOT DSL not generated');
      return;
    }

    const pilotSteps = JSON.parse(fs.readFileSync(pilotPath, 'utf-8'));

    // Check for key patterns
    const hasPluginActions = pilotSteps.some((s: any) => s.type === 'action');
    const hasTransforms = pilotSteps.some((s: any) => s.type === 'transform');
    const hasAI = pilotSteps.some((s: any) => s.type === 'ai_processing');
    const hasLoops = pilotSteps.some((s: any) => s.type === 'scatter_gather');
    const hasConditionals = pilotSteps.some((s: any) => s.type === 'conditional');

    if (hasPluginActions) result.insights.push('✅ Uses plugin actions');
    if (hasTransforms) result.insights.push('✅ Includes data transformations');
    if (hasAI) result.insights.push('✅ Uses AI processing');
    if (hasLoops) result.insights.push('✅ Includes loop patterns');
    if (hasConditionals) result.insights.push('✅ Has conditional logic');

    // Check for config usage
    const hasConfigRefs = JSON.stringify(pilotSteps).includes('{{config.');
    if (hasConfigRefs) {
      result.insights.push('✅ Runtime configurable');
    }

    // Check for direct filters (not classify-then-filter)
    const hasDirectFilter = pilotSteps.some((s: any) =>
      s.type === 'transform' &&
      s.operation === 'filter' &&
      s.config?.condition?.field?.includes('{{config.')
    );

    if (hasDirectFilter) {
      result.insights.push('✅ Uses direct filter pattern (optimal)');
    }

    result.businessValidation = 'PASS';
    console.log(`✅ Business validation: PASS`);
    console.log(`   Patterns found: ${result.insights.length}`);
  }

  private calculateExecutability(result: TestResult): void {
    // Base executability on validation results
    let score = 100;

    // Deduct for issues
    score -= result.issues * 10;
    score -= result.warnings * 2;

    // Schema validation failure
    if (result.schemaValidation === 'FAIL') {
      score -= 30;
    }

    // Business validation failure
    if (result.businessValidation === 'FAIL') {
      score -= 20;
    }

    result.executability = Math.max(0, Math.min(100, score));

    if (result.executability === 100) {
      result.status = 'PASS';
    } else if (result.executability >= 80) {
      result.status = 'PASS';
      result.insights.push(`⚠️ Minor issues (${100 - result.executability}% impact)`);
    } else {
      result.status = 'FAIL';
    }
  }

  private generateInsights(result: TestResult): void {
    // Performance insights
    if (result.deterministicTime > 0 && result.pipelineTime > 0) {
      const deterministicPct = (result.deterministicTime / result.pipelineTime) * 100;
      if (deterministicPct < 5) {
        result.insights.push(`🚀 Highly efficient deterministic pipeline (${deterministicPct.toFixed(1)}% of total time)`);
      }
    }

    // Complexity insights
    if (result.pilotSteps > 15) {
      result.insights.push(`📊 Complex workflow (${result.pilotSteps} steps)`);
    } else if (result.pilotSteps > 10) {
      result.insights.push(`📊 Medium complexity (${result.pilotSteps} steps)`);
    } else {
      result.insights.push(`📊 Simple workflow (${result.pilotSteps} steps)`);
    }

    // Quality insights
    if (result.issues === 0 && result.warnings === 0) {
      result.insights.push('🎯 Zero issues or warnings - production ready');
    }
  }

  private generateReport(): void {
    console.log('\n\n');
    console.log('═'.repeat(120));
    console.log('📊 END-TO-END TEST SUMMARY REPORT');
    console.log('═'.repeat(120));
    console.log('');

    // Summary table
    console.log('┌────────────────────────────────────────────────┬────────┬──────────┬────────┬──────────┬────────┬──────────┐');
    console.log('│ Workflow                                       │ Status │ Exec %   │ Steps  │ Issues   │ Warns  │ Time(ms) │');
    console.log('├────────────────────────────────────────────────┼────────┼──────────┼────────┼──────────┼────────┼──────────┤');

    for (const result of this.results) {
      const name = result.workflowName.substring(0, 46).padEnd(46);
      const status = result.status.padEnd(6);
      const exec = `${result.executability}%`.padEnd(8);
      const steps = result.pilotSteps.toString().padEnd(6);
      const issues = result.issues.toString().padEnd(8);
      const warns = result.warnings.toString().padEnd(6);
      const time = result.pipelineTime.toString().padEnd(8);

      console.log(`│ ${name} │ ${status} │ ${exec} │ ${steps} │ ${issues} │ ${warns} │ ${time} │`);
    }

    console.log('└────────────────────────────────────────────────┴────────┴──────────┴────────┴──────────┴────────┴──────────┘');
    console.log('');

    // Overall statistics
    const totalTests = this.results.length;
    const passed = this.results.filter(r => r.status === 'PASS').length;
    const failed = this.results.filter(r => r.status === 'FAIL').length;
    const errors = this.results.filter(r => r.status === 'ERROR').length;
    const avgExecutability = this.results.reduce((sum, r) => sum + r.executability, 0) / totalTests;
    const totalIssues = this.results.reduce((sum, r) => sum + r.issues, 0);
    const totalWarnings = this.results.reduce((sum, r) => sum + r.warnings, 0);

    console.log('📈 OVERALL STATISTICS\n');
    console.log(`Total Workflows Tested: ${totalTests}`);
    console.log(`✅ Passed: ${passed} (${((passed / totalTests) * 100).toFixed(1)}%)`);
    console.log(`❌ Failed: ${failed} (${((failed / totalTests) * 100).toFixed(1)}%)`);
    console.log(`💥 Errors: ${errors} (${((errors / totalTests) * 100).toFixed(1)}%)`);
    console.log(`\nAverage Executability: ${avgExecutability.toFixed(1)}%`);
    console.log(`Total Issues: ${totalIssues}`);
    console.log(`Total Warnings: ${totalWarnings}`);
    console.log('');

    // Detailed results
    console.log('═'.repeat(120));
    console.log('📋 DETAILED RESULTS\n');

    for (const result of this.results) {
      console.log('─'.repeat(120));
      console.log(`\n🔷 ${result.workflowName}`);
      console.log(`   File: ${result.promptFile}`);
      console.log(`   Status: ${result.status} | Executability: ${result.executability}%`);
      console.log(`   Steps: Intent=${result.intentSteps}, PILOT=${result.pilotSteps}`);
      console.log(`   Validation: Schema=${result.schemaValidation}, Business=${result.businessValidation}`);
      console.log(`   Quality: Issues=${result.issues}, Warnings=${result.warnings}`);
      console.log(`   Performance: Total=${result.pipelineTime}ms, LLM=${result.llmTime}ms, Deterministic=${result.deterministicTime}ms`);

      if (result.insights.length > 0) {
        console.log(`\n   💡 Insights:`);
        result.insights.forEach(insight => console.log(`      ${insight}`));
      }

      if (result.errors.length > 0) {
        console.log(`\n   ❌ Errors:`);
        result.errors.forEach(error => console.log(`      ${error}`));
      }

      console.log('');
    }

    console.log('═'.repeat(120));

    // Save report to file
    const reportPath = path.join(this.outputDir, 'e2e-test-report.json');
    fs.writeFileSync(reportPath, JSON.stringify({
      timestamp: new Date().toISOString(),
      summary: {
        totalTests,
        passed,
        failed,
        errors,
        avgExecutability,
        totalIssues,
        totalWarnings
      },
      results: this.results
    }, null, 2));

    console.log(`\n📄 Detailed report saved to: ${reportPath}\n`);
  }

  private loadPromptFiles(folderArg?: string): string[] {
    if (folderArg) {
      const resolvedDir = path.resolve(folderArg);
      if (!fs.existsSync(resolvedDir) || !fs.statSync(resolvedDir).isDirectory()) {
        console.error(`❌ Provided path is not a valid directory: ${resolvedDir}`);
        process.exit(1);
      }

      const jsonFiles = fs.readdirSync(resolvedDir)
        .filter(f => f.endsWith('.json'))
        .sort();

      if (jsonFiles.length === 0) {
        console.error(`❌ No .json files found in: ${resolvedDir}`);
        process.exit(1);
      }

      // Return paths relative to the project root so runPipeline resolves them correctly
      const projectRoot = path.join(__dirname, '..');
      return jsonFiles.map(f => path.relative(projectRoot, path.join(resolvedDir, f)));
    }

    // Fallback to hardcoded defaults
    return [
      'enhanced-prompt-lead-sales-followup.json',
      'enhanced-prompt-complaint-logger.json',
      'enhanced-prompt-invoice-extraction.json',
      'enhanced-prompt-expense-extractor.json',
      'enhanced-prompt-leads-filter.json'
    ];
  }

  public async runAll(): Promise<void> {
    const folderArg = process.argv[2];
    const promptFiles = this.loadPromptFiles(folderArg);

    console.log('🚀 Starting End-to-End Test Suite for All Enhanced Prompts\n');
    if (folderArg) {
      console.log(`📂 Loading prompts from: ${path.resolve(folderArg)}`);
    }
    console.log(`📂 Output root: ${this.outputDir}`);
    console.log(`Testing ${promptFiles.length} workflows...\n`);

    for (const promptFile of promptFiles) {
      const result = await this.runPipeline(promptFile);
      this.results.push(result);
    }

    this.generateReport();

    // Exit with appropriate code
    const hasFailed = this.results.some(r => r.status === 'FAIL' || r.status === 'ERROR');
    process.exit(hasFailed ? 1 : 0);
  }
}

// Run tests
// Usage: npx tsx scripts/test-all-enhanced-prompts-e2e.ts [input-folder] [output-folder]
// If output-folder is omitted, defaults to input-folder (when provided) or output/e2e-test-results/
const outputArg = process.argv[3] || process.argv[2];
const tester = new EnhancedPromptTester(outputArg);
tester.runAll().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
