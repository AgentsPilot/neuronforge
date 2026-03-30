/**
 * Quick analysis of leads-filter PILOT DSL for real executability issues
 */

import fs from 'fs'

const pilotFile = 'output/vocabulary-pipeline/pilot-dsl-steps.json'
const steps = JSON.parse(fs.readFileSync(pilotFile, 'utf-8'))

console.log('🔍 Analyzing leads-filter PILOT DSL for REAL executability issues...\n')

interface Issue {
  severity: string
  step: string
  problem: string
  current: any
  fix: any
}

const issues: Issue[] = []

// Analyze each step
for (const step of steps) {
  console.log(`\nStep ${step.step_id} (${step.type}):`)

  if (step.type === 'action' && step.plugin === 'google-mail' && step.operation === 'send_email') {
    console.log(`  📧 Email step - checking content references...`)

    const content = step.config?.content
    if (content) {
      console.log(`     Subject: ${JSON.stringify(content.subject)}`)
      console.log(`     Body: ${JSON.stringify(content.html_body || content.body)}`)

      // Check if subject is a plain string that looks like a variable reference
      if (content.subject && typeof content.subject === 'string' && content.subject.includes('.')) {
        if (!content.subject.startsWith('{{')) {
          issues.push({
            severity: 'CRITICAL',
            step: step.step_id,
            problem: 'Email subject is plain string instead of variable reference',
            current: content.subject,
            fix: `{{${content.subject}}}`
          })
          console.log(`     ❌ CRITICAL: Subject should be {{${content.subject}}}`)
        } else {
          console.log(`     ✅ Subject format OK`)
        }
      }

      // Check body
      const body = content.html_body || content.body
      if (body && typeof body === 'string' && body.includes('.')) {
        if (!body.startsWith('{{')) {
          issues.push({
            severity: 'CRITICAL',
            step: step.step_id,
            problem: 'Email body is plain string instead of variable reference',
            current: body,
            fix: `{{${body}}}`
          })
          console.log(`     ❌ CRITICAL: Body should be {{${body}}}`)
        } else {
          console.log(`     ✅ Body format OK`)
        }
      }
    }
  }

  // Check conditional steps
  if (step.type === 'conditional') {
    console.log(`  🔀 Conditional branch`)
    console.log(`     Condition: ${JSON.stringify(step.condition)}`)

    // Check then branch
    if (step.steps) {
      console.log(`     Then branch: ${step.steps.length} steps`)
      for (const substep of step.steps) {
        if (substep.type === 'action' && substep.plugin === 'google-mail') {
          const content = substep.config?.content
          if (content?.subject && typeof content.subject === 'string' && content.subject.includes('.') && !content.subject.startsWith('{{')) {
            issues.push({
              severity: 'CRITICAL',
              step: substep.step_id,
              problem: 'Email subject in conditional branch is plain string',
              current: content.subject,
              fix: `{{${content.subject}}}`
            })
            console.log(`       ❌ CRITICAL: ${substep.step_id} subject should be {{${content.subject}}}`)
          }

          const body = content?.html_body || content?.body
          if (body && typeof body === 'string' && body.includes('.') && !body.startsWith('{{')) {
            issues.push({
              severity: 'CRITICAL',
              step: substep.step_id,
              problem: 'Email body in conditional branch is plain string',
              current: body,
              fix: `{{${body}}}`
            })
            console.log(`       ❌ CRITICAL: ${substep.step_id} body should be {{${body}}}`)
          }
        }
      }
    }

    // Check else branch
    if (step.else_steps) {
      console.log(`     Else branch: ${step.else_steps.length} steps`)
      for (const substep of step.else_steps) {
        if (substep.type === 'action' && substep.plugin === 'google-mail') {
          const content = substep.config?.content
          if (content?.subject && typeof content.subject === 'string' && content.subject.includes('.') && !content.subject.startsWith('{{')) {
            issues.push({
              severity: 'CRITICAL',
              step: substep.step_id,
              problem: 'Email subject in else branch is plain string',
              current: content.subject,
              fix: `{{${content.subject}}}`
            })
            console.log(`       ❌ CRITICAL: ${substep.step_id} subject should be {{${content.subject}}}`)
          }

          const body = content?.html_body || content?.body
          if (body && typeof body === 'string' && body.includes('.') && !body.startsWith('{{')) {
            issues.push({
              severity: 'CRITICAL',
              step: substep.step_id,
              problem: 'Email body in else branch is plain string',
              current: body,
              fix: `{{${body}}}`
            })
            console.log(`       ❌ CRITICAL: ${substep.step_id} body should be {{${body}}}`)
          }
        }
      }
    }
  }
}

console.log(`\n${'='.repeat(80)}`)
console.log('SUMMARY')
console.log('='.repeat(80))

if (issues.length === 0) {
  console.log('✅ No critical issues found!')
} else {
  console.log(`❌ Found ${issues.length} CRITICAL issues that WILL FAIL at runtime:\n`)

  issues.forEach((issue, i) => {
    console.log(`${i + 1}. [${issue.step}] ${issue.problem}`)
    console.log(`   Current:  ${JSON.stringify(issue.current)}`)
    console.log(`   Should be: ${JSON.stringify(issue.fix)}`)
    console.log()
  })

  console.log(`\n🔴 THESE WORKFLOWS WILL FAIL TO EXECUTE`)
  console.log(`   Gmail will send literal text like "html_content.subject" instead of the actual subject`)
}

// Save report
fs.writeFileSync(
  'LEADS-FILTER-ISSUES.json',
  JSON.stringify({ issues, total: issues.length }, null, 2)
)
console.log(`\n📄 Report saved to: LEADS-FILTER-ISSUES.json`)
