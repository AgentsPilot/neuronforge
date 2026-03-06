#!/usr/bin/env node
/**
 * Comprehensive audit of plugin schemas to ensure they have everything needed
 * for robust workflow generation
 */

const fs = require('fs');
const path = require('path');

const pluginsDir = path.join(__dirname, '../lib/plugins/definitions');
const pluginFiles = fs.readdirSync(pluginsDir).filter(f => f.endsWith('-plugin-v2.json'));

console.log('='.repeat(80));
console.log('Plugin Completeness Audit');
console.log('='.repeat(80));
console.log('');

const issues = [];
const warnings = [];
const stats = {
  totalPlugins: pluginFiles.length,
  totalActions: 0,
  missingFields: {
    description: 0,
    usage_context: 0,
    parameters: 0,
    output_schema: 0,
    output_guidance: 0,
    idempotent: 0,
    rules: 0
  },
  outputSchemaQuality: {
    hasProperties: 0,
    missingProperties: 0,
    hasDescription: 0,
    emptySchema: 0
  },
  parameterQuality: {
    hasRequired: 0,
    hasProperties: 0,
    hasDescriptions: 0,
    missingType: 0
  }
};

function auditAction(pluginName, actionName, action, allActions) {
  stats.totalActions++;
  const actionPath = `${pluginName}.${actionName}`;

  // 1. Check required top-level fields
  if (!action.description) {
    issues.push(`${actionPath}: Missing 'description'`);
    stats.missingFields.description++;
  }

  if (!action.usage_context) {
    issues.push(`${actionPath}: Missing 'usage_context'`);
    stats.missingFields.usage_context++;
  }

  if (!action.parameters) {
    issues.push(`${actionPath}: Missing 'parameters'`);
    stats.missingFields.parameters++;
  }

  if (!action.output_schema) {
    warnings.push(`${actionPath}: Missing 'output_schema' (optional but recommended)`);
    stats.missingFields.output_schema++;
  }

  if (!action.output_guidance) {
    issues.push(`${actionPath}: Missing 'output_guidance'`);
    stats.missingFields.output_guidance++;
  }

  if (!('idempotent' in action)) {
    issues.push(`${actionPath}: Missing 'idempotent' field`);
    stats.missingFields.idempotent++;
  }

  if (!action.rules) {
    warnings.push(`${actionPath}: Missing 'rules' (optional)`);
    stats.missingFields.rules++;
  }

  // 2. Check output_schema quality
  if (action.output_schema) {
    if (action.output_schema.properties) {
      stats.outputSchemaQuality.hasProperties++;

      // Check if properties have descriptions
      const props = action.output_schema.properties;
      const propsWithDesc = Object.values(props).filter(p => p.description).length;
      const totalProps = Object.keys(props).length;

      if (propsWithDesc < totalProps) {
        warnings.push(`${actionPath}: ${totalProps - propsWithDesc}/${totalProps} output properties missing descriptions`);
      }
    } else {
      stats.outputSchemaQuality.missingProperties++;
      warnings.push(`${actionPath}: output_schema has no 'properties' field`);
    }

    if (action.output_schema.description) {
      stats.outputSchemaQuality.hasDescription++;
    }

    if (Object.keys(action.output_schema).length === 1 && action.output_schema.type) {
      stats.outputSchemaQuality.emptySchema++;
      warnings.push(`${actionPath}: output_schema only has 'type', no properties defined`);
    }
  }

  // 3. Check parameters quality
  if (action.parameters) {
    if (action.parameters.required && action.parameters.required.length > 0) {
      stats.parameterQuality.hasRequired++;
    }

    if (action.parameters.properties) {
      stats.parameterQuality.hasProperties++;

      // Check if parameters have descriptions and types
      const props = action.parameters.properties;
      let missingDesc = 0;
      let missingType = 0;

      for (const [paramName, paramDef] of Object.entries(props)) {
        if (!paramDef.description) {
          missingDesc++;
        }
        if (!paramDef.type) {
          missingType++;
          issues.push(`${actionPath}: parameter '${paramName}' missing 'type'`);
          stats.parameterQuality.missingType++;
        }
      }

      if (missingDesc > 0) {
        warnings.push(`${actionPath}: ${missingDesc} parameters missing descriptions`);
      }
    } else {
      warnings.push(`${actionPath}: parameters has no 'properties' field`);
    }
  }

  // 4. Check output_guidance quality
  if (action.output_guidance) {
    if (!action.output_guidance.success_description) {
      issues.push(`${actionPath}: output_guidance missing 'success_description'`);
    }

    if (!action.output_guidance.common_errors) {
      warnings.push(`${actionPath}: output_guidance missing 'common_errors'`);
    }

    if (!action.output_guidance.sample_output) {
      warnings.push(`${actionPath}: output_guidance missing 'sample_output'`);
    }
  }

  // 5. Check idempotent alternatives
  if (action.idempotent === false && action.idempotent_alternative) {
    // Verify the alternative exists
    if (!allActions.includes(action.idempotent_alternative)) {
      issues.push(`${actionPath}: idempotent_alternative '${action.idempotent_alternative}' does not exist`);
    }
  }

  // 6. Check for common anti-patterns
  if (actionName.startsWith('create_') && !action.idempotent_alternative) {
    const expectedAlt = `get_or_create_${actionName.replace(/^create_/, '')}`;
    if (allActions.includes(expectedAlt)) {
      warnings.push(`${actionPath}: Has get_or_create alternative but not linked (expected: ${expectedAlt})`);
    }
  }
}

function auditPlugin(pluginFile) {
  const filePath = path.join(pluginsDir, pluginFile);
  const plugin = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const pluginName = plugin.plugin.name;

  console.log(`📦 ${pluginName}`);

  // Check plugin-level fields
  const pluginMeta = plugin.plugin;
  if (!pluginMeta.name) issues.push(`${pluginName}: Missing plugin.name`);
  if (!pluginMeta.version) issues.push(`${pluginName}: Missing plugin.version`);
  if (!pluginMeta.description) issues.push(`${pluginName}: Missing plugin.description`);
  if (!pluginMeta.context) warnings.push(`${pluginName}: Missing plugin.context`);
  if (!pluginMeta.category) warnings.push(`${pluginName}: Missing plugin.category`);
  if (!pluginMeta.auth_config) issues.push(`${pluginName}: Missing plugin.auth_config`);

  // Audit all actions
  const actions = plugin.actions;
  const actionNames = Object.keys(actions);

  console.log(`   ${actionNames.length} actions`);

  for (const actionName of actionNames) {
    auditAction(pluginName, actionName, actions[actionName], actionNames);
  }

  console.log('');
}

// Run audit
for (const file of pluginFiles) {
  auditPlugin(file);
}

// Print summary
console.log('='.repeat(80));
console.log('Audit Summary');
console.log('='.repeat(80));
console.log('');

console.log(`Total Plugins: ${stats.totalPlugins}`);
console.log(`Total Actions: ${stats.totalActions}`);
console.log('');

console.log('Missing Required Fields:');
console.log(`  description: ${stats.missingFields.description}`);
console.log(`  usage_context: ${stats.missingFields.usage_context}`);
console.log(`  parameters: ${stats.missingFields.parameters}`);
console.log(`  output_guidance: ${stats.missingFields.output_guidance}`);
console.log(`  idempotent: ${stats.missingFields.idempotent}`);
console.log('');

console.log('Missing Optional Fields:');
console.log(`  output_schema: ${stats.missingFields.output_schema}`);
console.log(`  rules: ${stats.missingFields.rules}`);
console.log('');

console.log('Output Schema Quality:');
console.log(`  With properties: ${stats.outputSchemaQuality.hasProperties}/${stats.totalActions - stats.missingFields.output_schema}`);
console.log(`  Empty schemas: ${stats.outputSchemaQuality.emptySchema}`);
console.log('');

console.log('Parameter Quality:');
console.log(`  With required fields: ${stats.parameterQuality.hasRequired}/${stats.totalActions}`);
console.log(`  With properties: ${stats.parameterQuality.hasProperties}/${stats.totalActions}`);
console.log(`  Parameters missing type: ${stats.parameterQuality.missingType}`);
console.log('');

// Print issues
if (issues.length > 0) {
  console.log('='.repeat(80));
  console.log(`❌ CRITICAL ISSUES (${issues.length})`);
  console.log('='.repeat(80));
  issues.forEach(issue => console.log(`  - ${issue}`));
  console.log('');
}

if (warnings.length > 0) {
  console.log('='.repeat(80));
  console.log(`⚠️  WARNINGS (${warnings.length})`);
  console.log('='.repeat(80));
  console.log('(Showing first 20 warnings)');
  warnings.slice(0, 20).forEach(warning => console.log(`  - ${warning}`));
  if (warnings.length > 20) {
    console.log(`  ... and ${warnings.length - 20} more`);
  }
  console.log('');
}

// Final verdict
console.log('='.repeat(80));
if (issues.length === 0) {
  console.log('✅ ALL CRITICAL CHECKS PASSED');
  if (warnings.length > 0) {
    console.log(`⚠️  ${warnings.length} non-critical warnings (optional improvements)`);
  }
  console.log('✅ Plugins have everything needed for workflow generation');
} else {
  console.log(`❌ ${issues.length} CRITICAL ISSUES FOUND`);
  console.log('Plugins are missing required fields for robust workflow generation');
}
console.log('='.repeat(80));

process.exit(issues.length > 0 ? 1 : 0);
