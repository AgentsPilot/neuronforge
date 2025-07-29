import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

export function generatePDF(title: string, data: Record<string, any>): Uint8Array {
  const doc = new jsPDF()
  doc.setFontSize(16)
  doc.text(title, 14, 22)

  const rows = Object.entries(data).map(([key, value]) => [
    key,
    typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value),
  ])

  autoTable(doc, {
    head: [['Field', 'Value']],
    body: rows,
    startY: 30,
  })

  return doc.output('arraybuffer') // ✅ This is the key line
}