/**
 * A1: FileLoader — Load and validate input files for DSL execution simulation
 */

import fs from 'fs'
import path from 'path'

export interface LoadedFiles {
  dslSteps: any[]
  workflowConfig: Record<string, any>
  dataSchema: Record<string, any>
}

const DEFAULT_OUTPUT_DIR = path.join(process.cwd(), 'output', 'vocabulary-pipeline')

export function loadInputFiles(outputDir: string = DEFAULT_OUTPUT_DIR): LoadedFiles {
  const files = {
    dsl: path.join(outputDir, 'phase4-pilot-dsl-steps.json'),
    config: path.join(outputDir, 'phase4-workflow-config.json'),
    schema: path.join(outputDir, 'phase2-data-schema.json'),
  }

  // Validate all files exist
  const missing: string[] = []
  for (const [label, filePath] of Object.entries(files)) {
    if (!fs.existsSync(filePath)) {
      missing.push(`${label}: ${filePath}`)
    }
  }
  if (missing.length > 0) {
    throw new Error(`Missing input files:\n  ${missing.join('\n  ')}`)
  }

  const dslSteps = JSON.parse(fs.readFileSync(files.dsl, 'utf-8'))
  const workflowConfig = JSON.parse(fs.readFileSync(files.config, 'utf-8'))
  const dataSchema = JSON.parse(fs.readFileSync(files.schema, 'utf-8'))

  if (!Array.isArray(dslSteps)) {
    throw new Error(`DSL steps file must contain a JSON array, got ${typeof dslSteps}`)
  }

  console.log(`  Loaded ${dslSteps.length} DSL steps from phase4-pilot-dsl-steps.json`)
  console.log(`  Loaded ${Object.keys(workflowConfig).length} config keys from phase4-workflow-config.json (post-O7 merge)`)
  console.log(`  Loaded data schema from phase2-data-schema.json`)

  return { dslSteps, workflowConfig, dataSchema }
}
