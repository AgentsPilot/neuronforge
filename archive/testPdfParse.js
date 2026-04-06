const fs = require('fs')
const pdfParse = require('pdf-parse')

async function test() {
  try {
    const buffer = fs.readFileSync('./sample.pdf') // Make sure this file exists
    const result = await pdfParse(buffer)
    console.log('✅ PDF Parsed text:\n', result.text)
  } catch (err) {
    console.error('❌ PDF parse failed:', err)
  }
}

test()