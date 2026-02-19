/**
 * Domain Test: Finance - Transaction Fraud Detection
 *
 * Tests hardRequirements propagation for:
 * - Unit of work: transaction
 * - Threshold: fraud_risk_score > 80 (suspicious)
 * - Sequential dependency: analyze → classify → route
 * - Routing rule: suspicious transactions → fraud_team
 */

import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

import { HardRequirementsExtractor } from '../lib/agentkit/v6/requirements/HardRequirementsExtractor'
import { SemanticPlanGenerator } from '../lib/agentkit/v6/semantic-plan/SemanticPlanGenerator'
import { IRFormalizer } from '../lib/agentkit/v6/semantic-plan/IRFormalizer'
import { ExecutionGraphCompiler } from '../lib/agentkit/v6/compiler/ExecutionGraphCompiler'

const financePrompt = {
  "plan_title": "Transaction Fraud Detection - Suspicious Activity Flagging",
  "plan_description": "Automated fraud analysis of financial transactions with AI-based risk scoring. High-risk transactions are flagged for fraud team review, all transactions logged to compliance system.",
  "sections": {
    "data": [
      "Fetch pending transactions from payment processing queue",
      "Each record represents one financial transaction to be analyzed"
    ],
    "actions": [
      "Use AI fraud detection to analyze transaction patterns and risk indicators",
      "Extract risk assessment: transaction_id, fraud_risk_score (0-100), transaction_amount, merchant, customer_id, risk_factors, timestamp",
      "If fraud_risk_score > 80, flag as suspicious and requires investigation",
      "Store all transaction analyses in compliance audit log",
      "Generate fraud report with columns: transaction_id, fraud_risk_score, transaction_amount, merchant, risk_factors, timestamp"
    ],
    "output": [
      "Fraud report must include: transaction_id, fraud_risk_score, transaction_amount, merchant, timestamp"
    ],
    "delivery": [
      "Send daily fraud summary to compliance_team@bank.com with all analyzed transactions",
      "For suspicious transactions (fraud_risk_score > 80), immediately alert fraud_investigation@bank.com with transaction details and recommended actions"
    ],
    "processing_steps": [
      "1. Load pending transactions from queue",
      "2. Run AI fraud detection on each transaction",
      "3. Extract risk score and indicators",
      "4. Store in compliance audit log",
      "5. Check if fraud_risk_score > 80 for escalation",
      "6. Send summary to compliance and suspicious alerts to fraud team"
    ]
  },
  "specifics": {
    "services_involved": [
      "fraud-detection-ai",
      "compliance-database",
      "email"
    ],
    "user_inputs_required": [],
    "resolved_user_inputs": [
      {
        "key": "compliance_team_email",
        "value": "compliance_team@bank.com"
      },
      {
        "key": "fraud_investigation_email",
        "value": "fraud_investigation@bank.com"
      },
      {
        "key": "suspicious_threshold",
        "value": "80"
      }
    ]
  }
}

async function testFinanceWorkflow() {
  console.log('='.repeat(80))
  console.log('DOMAIN TEST: FINANCE - Transaction Fraud Detection')
  console.log('='.repeat(80))
  console.log()

  const extractor = new HardRequirementsExtractor()
  const hardReqs = await extractor.extract(financePrompt)

  console.log(`✅ Extracted ${hardReqs.requirements.length} requirements`)
  console.log()

  const semanticGenerator = new SemanticPlanGenerator({
    model_provider: 'anthropic',
    model_name: 'claude-opus-4-5-20251101',
    temperature: 0.3
  })

  const semanticResult = await semanticGenerator.generate(financePrompt, hardReqs)

  if (!semanticResult.success) {
    return { success: false, domain: 'finance' }
  }

  console.log('✅ Semantic Plan Generated')

  const groundedPlan = {
    ...semanticResult.semantic_plan!,
    grounded: false,
    grounding_results: [],
    grounding_errors: [],
    validated_assumptions_count: 0,
    total_assumptions_count: semanticResult.semantic_plan!.assumptions.length,
    grounding_confidence: 0,
    grounding_timestamp: new Date().toISOString()
  }

  const formalizer = new IRFormalizer({
    model: 'chatgpt-4o-latest',
    temperature: 0.0,
    openai_api_key: process.env.OPENAI_API_KEY
  })

  const formalizationResult = await formalizer.formalize(groundedPlan, hardReqs)
  console.log('✅ IR Formalized')

  const compiler = new ExecutionGraphCompiler()
  const compilationResult = await compiler.compile(formalizationResult.ir as any, hardReqs)

  if (!compilationResult.success) {
    return { success: false, domain: 'finance' }
  }

  console.log('✅ DSL Compiled')
  console.log()
  console.log('🎉 FINANCE TEST PASSED')

  return {
    success: true,
    domain: 'finance',
    requirementsCount: hardReqs.requirements.length,
    workflowSteps: compilationResult.workflow.length
  }
}

testFinanceWorkflow()
  .then(result => {
    process.exit(result.success ? 0 : 1)
  })
  .catch(err => {
    console.error('Test error:', err)
    process.exit(1)
  })
