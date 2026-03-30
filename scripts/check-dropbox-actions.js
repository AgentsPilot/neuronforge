const fs = require('fs');
const data = JSON.parse(fs.readFileSync('lib/plugins/definitions/dropbox-plugin-v2.json', 'utf8'));

console.log('Checking Dropbox actions for required fields:\n');

for (const [name, action] of Object.entries(data.actions)) {
  const hasDesc = !!action.description;
  const hasParams = !!action.parameters;
  const hasGuidance = !!action.output_guidance;

  if (!hasDesc || !hasParams || !hasGuidance) {
    console.log(`❌ ${name}: desc=${hasDesc}, params=${hasParams}, guidance=${hasGuidance}`);
  } else {
    console.log(`✅ ${name}`);
  }
}
