/**
 * MetricDetector - Auto-detect business metric step from workflow executions
 *
 * Purpose:
 * - Automatically identify which step represents the primary business metric
 * - Uses step_name semantic patterns (e.g., "Filter New Items Only")
 * - Falls back to data flow analysis (last transform before output)
 * - NO user configuration required
 *
 * Strategies:
 * 1. Pattern match on step_name (highest confidence)
 * 2. Last significant transform before output (medium confidence)
 * 3. Highest variance across executions (low confidence)
 * 4. Fallback to last non-system step
 *
 * @module lib/pilot/insight/MetricDetector
 */

import { createLogger } from '@/lib/logger';
import type { SupabaseClient } from '@supabase/supabase-js';

const logger = createLogger({ module: 'MetricDetector', service: 'business-intelligence' });

export interface StepMetric {
  plugin: string;
  action: string;
  step_name: string;
  step_id?: string;
  count: number;
  fields?: string[];
}

export interface DetectedMetric {
  step: StepMetric;
  step_index: number;
  confidence: number;  // 0.0 - 1.0
  detection_method: 'step_name_pattern' | 'last_transform_before_output' | 'variance_analysis' | 'fallback';
  pattern_matched?: string;
  reasoning?: string;
}

export class MetricDetector {
  private supabase: SupabaseClient;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  /**
   * Auto-detect which step represents the primary business metric
   * Uses step_name pattern matching + data flow analysis
   *
   * @param stepMetrics - Step metrics from current execution
   * @param agentId - Agent ID (for historical variance analysis)
   * @returns Detected business metric step with confidence score
   */
  async detectBusinessMetricStep(
    stepMetrics: StepMetric[],
    agentId?: string
  ): Promise<DetectedMetric> {
    // Strategy 1: Pattern match on step_name (HIGHEST CONFIDENCE)
    const patternDetection = this.detectByStepName(stepMetrics);
    if (patternDetection) {
      logger.info({
        agentId,
        stepName: patternDetection.step.step_name,
        confidence: patternDetection.confidence,
        method: patternDetection.detection_method,
      }, '✅ Business metric detected via step_name pattern');
      return patternDetection;
    }

    // Strategy 2: Last significant transform before output (MEDIUM CONFIDENCE)
    const transformDetection = this.detectLastTransformBeforeOutput(stepMetrics);
    if (transformDetection) {
      logger.info({
        agentId,
        stepName: transformDetection.step.step_name,
        confidence: transformDetection.confidence,
        method: transformDetection.detection_method,
      }, '✅ Business metric detected via data flow analysis');
      return transformDetection;
    }

    // Strategy 3: Highest variance across executions (LOW CONFIDENCE - requires historical data)
    if (agentId) {
      const varianceDetection = await this.detectByVariance(stepMetrics, agentId);
      if (varianceDetection) {
        logger.info({
          agentId,
          stepName: varianceDetection.step.step_name,
          confidence: varianceDetection.confidence,
          method: varianceDetection.detection_method,
        }, '✅ Business metric detected via variance analysis');
        return varianceDetection;
      }
    }

    // Strategy 4: Fallback to last non-system step (LOWEST CONFIDENCE)
    const fallback = this.detectFallback(stepMetrics);
    logger.warn({
      agentId,
      stepName: fallback.step.step_name,
      confidence: fallback.confidence,
    }, '⚠️ Using fallback business metric detection - may be inaccurate');
    return fallback;
  }

  /**
   * Strategy 1: Detect business metric step by semantic analysis of step_name
   * Uses multiple heuristics to identify business-relevant steps
   */
  private detectByStepName(stepMetrics: StepMetric[]): DetectedMetric | null {
    // Score each step based on multiple signals
    const scoredSteps = stepMetrics.map((step, index) => {
      let score = 0;
      let signals: string[] = [];

      const nameLower = step.step_name.toLowerCase();

      // Signal 1: Business-relevant keywords (HIGH signal)
      const businessKeywords = {
        // Filtering & Selection (3 points - strong signal)
        filtering: ['filter', 'select', 'where', 'matching', 'criteria'],
        newness: ['new', 'fresh', 'recent', 'latest', 'today'],
        deduplication: ['deduplicate', 'unique', 'distinct', 'remove duplicates', 'no duplicates'],
        qualification: ['qualified', 'eligible', 'valid', 'meets criteria', 'passes'],
        validation: ['validated', 'verified', 'confirmed', 'approved', 'checked'],
        exclusion: ['exclude', 'filter out', 'remove', 'skip', 'omit', 'without'],

        // Business states (2 points - medium signal)
        status: ['active', 'pending', 'open', 'unresolved', 'outstanding'],
        priority: ['priority', 'urgent', 'critical', 'high priority', 'important'],
        categorization: ['categorize', 'classify', 'tag', 'label', 'group by'],

        // Data quality (2 points - medium signal)
        cleaning: ['clean', 'sanitize', 'normalize', 'standardize', 'fix'],
        completion: ['complete', 'filled', 'has data', 'not empty', 'populated'],

        // Thresholds & Limits (1 point - weak signal)
        comparison: ['greater than', 'less than', 'above', 'below', 'between'],
        limits: ['top', 'bottom', 'first', 'last', 'limit to']
      };

      // Check each category
      for (const [category, keywords] of Object.entries(businessKeywords)) {
        const matchedKeyword = keywords.find(kw => nameLower.includes(kw));
        if (matchedKeyword) {
          let points = 3; // Default high signal

          if (['status', 'priority', 'categorization', 'cleaning', 'completion'].includes(category)) {
            points = 2; // Medium signal
          } else if (['comparison', 'limits'].includes(category)) {
            points = 1; // Weak signal
          }

          score += points;
          signals.push(`${category}: "${matchedKeyword}"`);
          break; // Only count first match
        }
      }

      // Signal 2: Combination patterns (strong business intent)
      const combinationPatterns = [
        { pattern: ['new', 'only'], score: 3, name: 'explicit new items filter' },
        { pattern: ['new', 'items'], score: 2, name: 'new items processing' },
        { pattern: ['not', 'exist'], score: 2, name: 'novelty check' },
        { pattern: ['only', 'if'], score: 1.5, name: 'conditional filter' },
        { pattern: ['where', 'is'], score: 1.5, name: 'criteria-based filter' },
        { pattern: ['has', 'no'], score: 1, name: 'exclusion filter' },
        { pattern: ['without', 'duplicate'], score: 2, name: 'deduplication filter' },
        { pattern: ['first', 'time'], score: 2, name: 'first occurrence filter' },
        { pattern: ['changed', 'since'], score: 1.5, name: 'delta detection' },
        { pattern: ['meets', 'criteria'], score: 2, name: 'qualification filter' }
      ];

      for (const { pattern, score: points, name } of combinationPatterns) {
        if (pattern.every(word => nameLower.includes(word))) {
          score += points;
          signals.push(name);
          break; // Only count first match
        }
      }

      // Domain-specific patterns
      const domainPatterns = {
        // E-commerce
        ecommerce: [
          { words: ['unpaid', 'order'], score: 2, name: 'unpaid orders (business metric)' },
          { words: ['abandoned', 'cart'], score: 2, name: 'abandoned carts (business metric)' },
          { words: ['refund', 'request'], score: 2, name: 'refund requests (business metric)' },
          { words: ['out of stock'], score: 2, name: 'inventory issue (business metric)' },
        ],
        // Customer service
        support: [
          { words: ['unresolved', 'ticket'], score: 2, name: 'open tickets (business metric)' },
          { words: ['escalated'], score: 2, name: 'escalated issues (business metric)' },
          { words: ['complaint'], score: 2, name: 'complaints (business metric)' },
          { words: ['overdue', 'response'], score: 2, name: 'overdue responses (business metric)' },
        ],
        // Sales & Marketing
        sales: [
          { words: ['qualified', 'lead'], score: 2, name: 'qualified leads (business metric)' },
          { words: ['converted'], score: 2, name: 'conversions (business metric)' },
          { words: ['hot', 'prospect'], score: 2, name: 'hot prospects (business metric)' },
          { words: ['engaged', 'contact'], score: 1.5, name: 'engaged contacts (business metric)' },
        ],
        // HR & Recruiting
        hr: [
          { words: ['pending', 'approval'], score: 1.5, name: 'pending approvals (business metric)' },
          { words: ['applicant'], score: 1.5, name: 'applicants (business metric)' },
          { words: ['onboarding'], score: 1.5, name: 'onboarding (business metric)' },
        ],
        // Finance
        finance: [
          { words: ['overdue', 'invoice'], score: 2, name: 'overdue invoices (business metric)' },
          { words: ['unpaid'], score: 2, name: 'unpaid items (business metric)' },
          { words: ['reconcile'], score: 1.5, name: 'reconciliation (business metric)' },
        ]
      };

      // Check all domain patterns
      let domainMatchFound = false;
      for (const patterns of Object.values(domainPatterns)) {
        for (const { words, score: points, name } of patterns) {
          if (words.every(word => nameLower.includes(word))) {
            score += points;
            signals.push(name);
            domainMatchFound = true;
            break;
          }
        }
        if (domainMatchFound) break; // Only count first domain match
      }

      // Signal 3: Business-specific filters (HIGHEST priority)
      // filter_group steps contain business logic (e.g., "customer service emails")
      // These should be prioritized over technical filters (e.g., "new items only")
      if (nameLower.includes('filter group') || nameLower.includes('group ')) {
        score += 5; // Very high signal for business filters
        signals.push('business filter group (HIGH PRIORITY)');
      }

      // Signal 4: Position in workflow (middle steps more likely)
      const position = index / stepMetrics.length;
      if (position > 0.3 && position < 0.8) {
        score += 1;
        signals.push('middle position');
      }

      // Signal 5: Count analysis (adaptive to workflow scale)
      const maxCount = Math.max(...stepMetrics.map(s => s.count));
      const avgCount = stepMetrics.reduce((sum, s) => sum + s.count, 0) / stepMetrics.length;

      if (step.count === 0) {
        // Zero count is meaningful - could be success OR problem (context-dependent)
        // Examples: "0 complaints" = success, "0 new leads" = problem
        // Don't bias the score - let LLM interpret based on workflow context
        signals.push('zero count (requires context to interpret)');
      } else if (step.count > 0) {
        // Meaningful count (not extreme)
        const ratio = step.count / maxCount;

        if (ratio > 0.1 && ratio < 0.9) {
          // In the middle range (not max, not minimum)
          score += 1;
          signals.push(`meaningful count (${step.count}, ${(ratio * 100).toFixed(0)}% of max)`);
        } else if (step.count === 1) {
          // Count of 1 is often summary/output
          score -= 0.5;
          signals.push('single item (likely summary)');
        }

        // Bonus for being close to average (likely representative)
        const avgDiff = Math.abs(step.count - avgCount) / avgCount;
        if (avgDiff < 0.3) {
          score += 0.5;
          signals.push('near average count');
        }
      }

      // Signal 6: Transform/Processing verbs (MEDIUM signal)
      const transformVerbs = {
        extraction: ['extract', 'parse', 'pull out', 'get value', 'find'],
        transformation: ['transform', 'convert', 'change', 'modify', 'update'],
        mapping: ['map', 'translate', 'remap', 'reshape', 'reformat'],
        aggregation: ['aggregate', 'sum', 'count', 'total', 'calculate'],
        grouping: ['group', 'group by', 'categorize', 'bucket'],
        merging: ['merge', 'join', 'combine', 'concat', 'union'],
        enrichment: ['enrich', 'enhance', 'augment', 'add to', 'append data'],
        calculation: ['compute', 'calculate', 'derive', 'determine']
      };

      for (const [type, verbs] of Object.entries(transformVerbs)) {
        if (verbs.some(verb => nameLower.includes(verb))) {
          score += 0.5;
          signals.push(`${type} step`);
          break;
        }
      }

      // Penalty: Likely output/storage steps (NEGATIVE signal)
      const outputIndicators = {
        writing: ['write', 'save', 'store', 'persist', 'insert'],
        sending: ['send', 'email', 'notify', 'alert', 'message'],
        appending: ['append', 'add to', 'update', 'upsert'],
        creating: ['create', 'generate', 'build', 'make'],
        exporting: ['export', 'download', 'output', 'produce'],
        publishing: ['publish', 'post', 'submit', 'upload'],
        summarizing: ['summary', 'report', 'digest', 'recap', 'overview']
      };

      for (const [type, keywords] of Object.entries(outputIndicators)) {
        if (keywords.some(kw => nameLower.includes(kw))) {
          score -= 2;
          signals.push(`${type} output (penalized)`);
          break;
        }
      }

      // Penalty: Technical filtering (NOT business filtering)
      // "Filter New Items" is deduplication logic, not business logic
      const technicalFilters = [
        'filter new items',
        'deduplicate',
        'remove duplicates',
        'pre-compute',
        'extract existing',
        'convert rows'
      ];

      for (const techFilter of technicalFilters) {
        if (nameLower.includes(techFilter)) {
          score -= 1;
          signals.push(`technical filter (penalized: "${techFilter}")`);
          break;
        }
      }

      // Penalty: Likely initial fetch/read steps
      const inputIndicators = {
        fetching: ['fetch', 'get', 'retrieve', 'pull', 'download'],
        reading: ['read', 'load', 'open', 'access'],
        querying: ['query', 'search', 'find all', 'list all', 'scan'],
        listing: ['list', 'enumerate', 'get all', 'collect']
      };

      if (index < 3) { // Only penalize if in first 3 steps
        for (const [type, keywords] of Object.entries(inputIndicators)) {
          if (keywords.some(kw => nameLower.includes(kw))) {
            score -= 1;
            signals.push(`initial ${type} (penalized)`);
            break;
          }
        }
      }

      return {
        step,
        index,
        score,
        signals,
      };
    });

    // Find highest scoring step
    const bestMatch = scoredSteps.reduce((max, current) =>
      current.score > max.score ? current : max
    );

    // Only return if score is meaningful (> 2)
    if (bestMatch.score > 2) {
      return {
        step: bestMatch.step,
        step_index: bestMatch.index,
        confidence: Math.min(0.9, 0.5 + (bestMatch.score / 10)), // Score-based confidence
        detection_method: 'step_name_pattern',
        reasoning: `Semantic analysis: ${bestMatch.signals.join(', ')} (score: ${bestMatch.score})`,
      };
    }

    return null;
  }

  /**
   * Strategy 2: Analyze workflow data flow to find business metric
   * Looks for "funnel narrowing" - steps where item count significantly changes
   */
  private detectLastTransformBeforeOutput(stepMetrics: StepMetric[]): DetectedMetric | null {
    if (stepMetrics.length < 2) return null;

    // Find steps where count changes significantly (funnel narrowing)
    const funnelSteps = stepMetrics
      .map((step, index) => {
        const prevCount = index > 0 ? stepMetrics[index - 1].count : 0;
        const countChange = prevCount > 0 ? (step.count - prevCount) / prevCount : 0;

        return {
          step,
          index,
          countChange,
          isNarrowing: countChange < -0.2, // 20%+ reduction
          isExpanding: countChange > 0.2,  // 20%+ increase
          absCountChange: Math.abs(countChange),
        };
      })
      .filter(s => s.step.count > 0 && s.step.plugin !== 'system');

    // Identify likely output steps (very low count, output-related names)
    const likelyOutputSteps = funnelSteps.filter(s => {
      const nameLower = s.step.step_name.toLowerCase();
      const isOutputName =
        nameLower.includes('send') ||
        nameLower.includes('append') ||
        nameLower.includes('write') ||
        nameLower.includes('save') ||
        nameLower.includes('summary') ||
        nameLower.includes('notification');

      const isVeryLowCount = s.step.count === 1;

      return isOutputName || isVeryLowCount;
    });

    // Find last funnel narrowing before output
    if (likelyOutputSteps.length > 0) {
      const firstOutputIndex = likelyOutputSteps[0].index;

      const candidateSteps = funnelSteps
        .filter(s => s.index < firstOutputIndex && s.isNarrowing)
        .reverse();

      if (candidateSteps.length > 0) {
        const detected = candidateSteps[0];
        return {
          step: detected.step,
          step_index: detected.index,
          confidence: 0.7,
          detection_method: 'last_transform_before_output',
          reasoning: `Funnel narrowing: ${(detected.countChange * 100).toFixed(0)}% reduction before output`,
        };
      }
    }

    // Fallback: Find step with highest count variation (likely business metric)
    const highestVariation = funnelSteps
      .filter(s => s.index > 0 && s.index < stepMetrics.length - 1) // Skip first and last
      .reduce((max, current) =>
        current.absCountChange > max.absCountChange ? current : max
      , { absCountChange: 0, step: null as any, index: -1 });

    if (highestVariation.step && highestVariation.absCountChange > 0.3) {
      return {
        step: highestVariation.step,
        step_index: highestVariation.index,
        confidence: 0.6,
        detection_method: 'last_transform_before_output',
        reasoning: `Highest count variation: ${(highestVariation.absCountChange * 100).toFixed(0)}% change`,
      };
    }

    return null;
  }

  /**
   * Strategy 3: Detect step with highest variance across recent executions
   * High variance = likely represents dynamic business metric
   */
  private async detectByVariance(
    stepMetrics: StepMetric[],
    agentId: string
  ): Promise<DetectedMetric | null> {
    try {
      // Fetch last 30 execution metrics
      const { data: recentMetrics, error } = await this.supabase
        .from('execution_metrics')
        .select('step_metrics')
        .eq('agent_id', agentId)
        .order('executed_at', { ascending: false })
        .limit(30);

      if (error || !recentMetrics || recentMetrics.length < 7) {
        // Need at least 7 executions for variance analysis
        return null;
      }

      // Calculate variance for each step position
      const variances = stepMetrics.map((step, stepIndex) => {
        const counts = recentMetrics
          .map((metric: any) => {
            const stepMetricsArray = metric.step_metrics || [];
            // Match by step_name (more reliable than position)
            const matchingStep = stepMetricsArray.find(
              (s: any) => s.step_name === step.step_name
            );
            return matchingStep?.count || 0;
          })
          .filter(count => count > 0);

        if (counts.length < 2) return { stepIndex, variance: 0, cv: 0 };

        const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
        const variance = counts.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / counts.length;
        const cv = variance / (mean || 1); // Coefficient of variation

        return { stepIndex, variance, cv, mean };
      });

      // Find step with highest coefficient of variation (normalized variance)
      const highestVariance = variances.reduce((max, current) =>
        current.cv > max.cv ? current : max
      );

      // Only use if CV is significant (> 0.2 = 20% variation)
      if (highestVariance.cv > 0.2) {
        return {
          step: stepMetrics[highestVariance.stepIndex],
          step_index: highestVariance.stepIndex,
          confidence: 0.6,
          detection_method: 'variance_analysis',
          reasoning: `Step shows ${(highestVariance.cv * 100).toFixed(0)}% variation across executions (indicates business metric)`,
        };
      }

      return null;
    } catch (error) {
      logger.error({ err: error, agentId }, 'Failed to detect metric by variance');
      return null;
    }
  }

  /**
   * Strategy 4: Fallback to last non-system step with count > 0
   */
  private detectFallback(stepMetrics: StepMetric[]): DetectedMetric {
    const candidateSteps = stepMetrics
      .map((step, index) => ({ step, index }))
      .filter(({ step }) => step.plugin !== 'system' && step.count > 0)
      .reverse();

    const fallback = candidateSteps[0] || { step: stepMetrics[0], index: 0 };

    return {
      step: fallback.step,
      step_index: fallback.index,
      confidence: 0.4,
      detection_method: 'fallback',
      reasoning: 'Last non-system step with items (may not be accurate business metric)',
    };
  }

  /**
   * Extract business metric value from execution metrics
   * Uses detected step to get count from specific step
   *
   * @param executionMetrics - Execution metrics with step_metrics array
   * @param detectedMetric - Detected business metric step
   * @returns Business metric value (count from detected step)
   */
  extractMetricValue(
    executionMetrics: { step_metrics?: StepMetric[] },
    detectedMetric: DetectedMetric
  ): number {
    if (!executionMetrics.step_metrics) {
      return 0;
    }

    // Find matching step by step_name (more reliable than index)
    const matchingStep = executionMetrics.step_metrics.find(
      s => s.step_name === detectedMetric.step.step_name
    );

    return matchingStep?.count || 0;
  }
}
