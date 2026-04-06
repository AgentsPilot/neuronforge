// download-simpleicons.js

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import * as si from "simple-icons";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// plugin ID → SimpleIcons export key
const ICON_MAP = {
  "google-mail-plugin-v2": "siGmail",
  "google-drive-plugin-v2": "siGoogledrive",
  "google-sheets-plugin-v2": "siGooglesheets",
  "google-docs-plugin-v2": "siGoogledocs",
  "google-calendar-plugin-v2": "siGooglecalendar",
  "slack-plugin-v2": "siSlack",
  "whatsapp-plugin-v2": "siWhatsapp",
  "hubspot-plugin-v2": "siHubspot",
  "chatgpt-research-plugin-v2": "siOpenai",
  // "linkedin-plugin-v2": "siLinkedin", // Not available in simple-icons
  "airtable-plugin-v2": "siAirtable",
  "google-ads-plugin-v2": "siGoogleads",
  "meta-ads-plugin-v2": "siMeta",
  "facebook-plugin-v2": "siFacebook",
  "instagram-plugin-v2": "siInstagram",
  "google-adsense-plugin-v2": "siGoogleadsense",
};

const outputDir = path.join(__dirname, "public/plugins");
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

for (const [pluginId, iconKey] of Object.entries(ICON_MAP)) {
  const icon = si[iconKey];

  if (!icon) {
    console.error(`❌ Icon not found in simple-icons: ${iconKey}`);
    continue;
  }

  const svgPath = path.join(outputDir, `${pluginId}.svg`);

  const svgContent = `
<svg xmlns="http://www.w3.org/2000/svg" role="img" viewBox="0 0 24 24">
  <title>${icon.title}</title>
  <path d="${icon.path}" fill="#${icon.hex}"/>
</svg>
  `.trim();

  fs.writeFileSync(svgPath, svgContent, "utf-8");
  console.log(`✓ Saved: ${pluginId}.svg`);
}

console.log("🎉 All icons saved to /public/plugins/");