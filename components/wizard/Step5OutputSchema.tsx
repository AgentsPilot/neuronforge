'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'

type OutputSchemaType = 'SummaryBlock' | 'EmailDraft' | 'Alert' | ''

export default function Step5OutputSchema({ data = {}, onUpdate }: any) {
  const defaultOutput = data.outputSchema || {}

  const [type, setType] = useState<OutputSchemaType>(defaultOutput?.type || '')
  const [to, setTo] = useState(defaultOutput?.to || '')
  const [subject, setSubject] = useState(defaultOutput?.subject || '')
  const [includePdf, setIncludePdf] = useState(defaultOutput?.includePdf || false)

  const [alertTitle, setAlertTitle] = useState(defaultOutput?.title || '')
  const [alertMessage, setAlertMessage] = useState(defaultOutput?.message || '')
  const [alertSeverity, setAlertSeverity] = useState(defaultOutput?.severity || 'info')

  useEffect(() => {
    const schema: any = { type }

    if (type === 'EmailDraft') {
      schema.to = to
      schema.subject = subject
      schema.includePdf = includePdf
    } else if (type === 'Alert') {
      schema.title = alertTitle
      schema.message = alertMessage
      schema.severity = alertSeverity
    }

    onUpdate({ outputSchema: schema })
  }, [type, to, subject, includePdf, alertTitle, alertMessage, alertSeverity])

  return (
    <Card>
      <CardContent className="space-y-4 p-6">
        <div>
          <Label>Output Type</Label>
          <Select value={type} onValueChange={setType}>
            <SelectTrigger className="w-full mt-1">
              <SelectValue placeholder="Select output type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="SummaryBlock">Summary (text block)</SelectItem>
              <SelectItem value="EmailDraft">Email</SelectItem>
              <SelectItem value="Alert">Alert (dashboard)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {type === 'EmailDraft' && (
          <div className="space-y-4">
            <div>
              <Label>To</Label>
              <Input
                type="email"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                placeholder="recipient@example.com"
              />
            </div>
            <div>
              <Label>Subject</Label>
              <Input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Email subject"
              />
            </div>
            <div className="flex items-center gap-2 mt-2">
              <Checkbox id="include-pdf" checked={includePdf} onCheckedChange={setIncludePdf} />
              <Label htmlFor="include-pdf">Include PDF export</Label>
            </div>
          </div>
        )}

        {type === 'Alert' && (
          <div className="space-y-4">
            <div>
              <Label>Alert Title</Label>
              <Input
                value={alertTitle}
                onChange={(e) => setAlertTitle(e.target.value)}
                placeholder="e.g. Server Down"
              />
            </div>
            <div>
              <Label>Alert Message Template</Label>
              <Input
                value={alertMessage}
                onChange={(e) => setAlertMessage(e.target.value)}
                placeholder="e.g. CPU usage exceeded for {{input.serverName}}"
              />
            </div>
            <div>
              <Label>Severity</Label>
              <Select value={alertSeverity} onValueChange={setAlertSeverity}>
                <SelectTrigger className="w-full mt-1">
                  <SelectValue placeholder="Select severity" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="info">Info</SelectItem>
                  <SelectItem value="warning">Warning</SelectItem>
                  <SelectItem value="error">Error</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}