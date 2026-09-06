/**
 * Minimal test for @react-pdf/renderer Hebrew support
 */
import React from 'react';
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Font,
  renderToBuffer,
} from '@react-pdf/renderer';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Register fonts
const fontsDir = path.join(process.cwd(), 'lib/pdf/fonts');

// Try different font registration approaches
console.log('Testing font registration approaches...\n');

// Approach 1: NotoSansHebrew with data URI
const hebrewRegularPath = path.join(fontsDir, 'NotoSansHebrew-Regular.ttf');
const hebrewBoldPath = path.join(fontsDir, 'NotoSansHebrew-Bold.ttf');

if (fs.existsSync(hebrewRegularPath)) {
  console.log('1. Registering NotoSansHebrew via data URI...');
  const regularData = fs.readFileSync(hebrewRegularPath);
  const boldData = fs.readFileSync(hebrewBoldPath);

  Font.register({
    family: 'NotoSansHebrew',
    fonts: [
      { src: `data:font/truetype;base64,${regularData.toString('base64')}`, fontWeight: 400 },
      { src: `data:font/truetype;base64,${boldData.toString('base64')}`, fontWeight: 700 },
    ],
  });
}

// Approach 2: Heebo variable font via file path
const heeboPath = path.join(fontsDir, 'Heebo-VariableFont_wght.ttf');
if (fs.existsSync(heeboPath)) {
  console.log('2. Registering Heebo via file path...');
  Font.register({
    family: 'Heebo',
    src: heeboPath,
  });
}

// Approach 3: NotoSansHebrew via file path
console.log('3. Registering NotoSansHebrew via file path...');
Font.register({
  family: 'NotoSansHebrewFile',
  fonts: [
    { src: hebrewRegularPath, fontWeight: 400 },
    { src: hebrewBoldPath, fontWeight: 700 },
  ],
});

// Create test documents
const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontSize: 14,
  },
  section: {
    marginBottom: 20,
  },
  title: {
    fontSize: 16,
    fontWeight: 700,
    marginBottom: 10,
    color: '#333',
  },
  text: {
    marginBottom: 5,
  },
});

interface TestDocProps {
  fontFamily: string;
  title: string;
}

const TestDocument: React.FC<TestDocProps> = ({ fontFamily, title }) => (
  <Document>
    <Page size="A4" style={[styles.page, { fontFamily }]}>
      <View style={styles.section}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.text}>Hebrew text: שלום עולם</Text>
        <Text style={styles.text}>Business name: העסק שלי בע״מ</Text>
        <Text style={styles.text}>Address: רחוב הרצל 123, תל אביב</Text>
        <Text style={styles.text}>Mixed: Invoice #12345 - חשבונית</Text>
        <Text style={styles.text}>Date: 6 באוגוסט 2026</Text>
        <Text style={styles.text}>Thank you: תודה על העסקה!</Text>
      </View>
      <View style={styles.section}>
        <Text style={styles.text}>English text: Hello World</Text>
        <Text style={styles.text}>Numbers: 1234567890</Text>
      </View>
    </Page>
  </Document>
);

async function testFont(fontFamily: string, filename: string) {
  console.log(`\nGenerating PDF with ${fontFamily}...`);
  try {
    const doc = React.createElement(TestDocument, { fontFamily, title: `Font: ${fontFamily}` });
    const buffer = await renderToBuffer(doc);
    const outputPath = path.join(os.homedir(), 'Desktop', filename);
    fs.writeFileSync(outputPath, buffer);
    console.log(`  ✅ Saved to: ${outputPath} (${buffer.length} bytes)`);
    return true;
  } catch (error) {
    console.error(`  ❌ Failed:`, error);
    return false;
  }
}

async function main() {
  console.log('\n=== Testing @react-pdf/renderer Hebrew Support ===\n');

  // Test each font
  await testFont('NotoSansHebrew', 'test-notosanshebrew-datauri.pdf');
  await testFont('Heebo', 'test-heebo-filepath.pdf');
  await testFont('NotoSansHebrewFile', 'test-notosanshebrew-filepath.pdf');

  console.log('\n=== Done! Check the PDFs on your Desktop ===\n');

  // Open the last one
  const { exec } = require('child_process');
  exec(`open "${path.join(os.homedir(), 'Desktop', 'test-heebo-filepath.pdf')}"`);
}

main();
