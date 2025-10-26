import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

export function generatePDF(data: any, _outputSchema?: any[]): void {
  const doc = new jsPDF()

  // Extract title from data or use default
  const title = data?.agent_name || data?.title || 'Agent Execution Report'

  doc.setFontSize(16)
  doc.text(String(title), 14, 22)

  // Handle AgentKit execution results
  if (data?.agentkit && data?.message) {
    // Add the main message
    doc.setFontSize(12)
    doc.text('Result:', 14, 35)

    const splitMessage = doc.splitTextToSize(String(data.message), 180)
    doc.setFontSize(10)
    doc.text(splitMessage, 14, 42)

    // Add execution metrics if available
    if (data.data) {
      const metricsY = 42 + (splitMessage.length * 5) + 10
      const metrics = [
        ['Steps', String(data.data.iterations || 'N/A')],
        ['Actions', String(data.data.tool_calls_count || 'N/A')],
        ['Tokens Used', String(data.data.tokens_used || 'N/A')],
        ['Duration', data.data.execution_time_ms ? `${(data.data.execution_time_ms / 1000).toFixed(1)}s` : 'N/A']
      ]

      autoTable(doc, {
        head: [['Metric', 'Value']],
        body: metrics,
        startY: metricsY,
        theme: 'grid'
      })
    }
  } else {
    // Legacy execution - show data fields
    const rows = Object.entries(data)
      .filter(([key]) => key !== 'send_status' && key !== 'agentkit' && key !== 'error')
      .map(([key, value]) => [
        key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
        typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value || 'N/A'),
      ])

    autoTable(doc, {
      head: [['Field', 'Value']],
      body: rows,
      startY: 30,
      theme: 'grid',
      styles: {
        cellPadding: 3,
        fontSize: 9
      },
      columnStyles: {
        0: { fontStyle: 'bold', cellWidth: 50 },
        1: { cellWidth: 130 }
      }
    })
  }

  // Download the PDF
  doc.save(`${title.replace(/[^a-z0-9]/gi, '_')}.pdf`)
}