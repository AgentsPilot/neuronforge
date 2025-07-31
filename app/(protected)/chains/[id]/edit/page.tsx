// app/(protected)/chains/[id]/page.tsx
'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'

export default function ChainDetailPage() {
  const { id } = useParams()
  const supabase = createClientComponentClient()
  const [chain, setChain] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState<any[]>([])
  const [initialInput, setInitialInput] = useState('')

  useEffect(() => {
    if (id) {
      supabase.from('agent_chains').select('*').eq('id', id).single().then(({ data }) => {
        setChain(data)
      })
    }
  }, [id])

  const runChain = async () => {
    setLoading(true)
    setResults([])

    const res = await fetch('/api/agent-chains/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent_ids: chain.steps.map((s: any) => s.agent_id),
        initial_input: initialInput ? JSON.parse(initialInput) : {},
      }),
    })

    const json = await res.json()
    if (json.results) {
      setResults(json.results)
    }
    setLoading(false)
  }

  if (!chain) return <p className="p-6 text-muted-foreground">Loading...</p>

  return (
    <div className="max-w-4xl mx-auto py-10 space-y-8">
      <div>
        <h1 className="text-2xl font-bold">{chain.title}</h1>
        <p className="text-sm text-muted-foreground">{chain.description}</p>
        <Badge variant="outline" className="mt-2">{chain.trigger_type}</Badge>
      </div>

      <div>
        <h2 className="text-lg font-semibold">Initial Input (JSON)</h2>
        <Input
          placeholder='{"topic": "sales report"}'
          value={initialInput}
          onChange={(e) => setInitialInput(e.target.value)}
        />
        <Button onClick={runChain} disabled={loading} className="mt-2">
          {loading ? 'Running...' : 'Test Run'}
        </Button>
      </div>

      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Steps</h2>
        {chain.steps.map((step: any, idx: number) => (
          <Card key={idx} className="p-4">
            <p className="text-sm font-medium">Step {idx + 1} — {step.alias}</p>
            <p className="text-sm text-muted-foreground">Agent ID: {step.agent_id}</p>
            {step.input_map && step.input_map.length > 0 && (
              <ul className="mt-2 pl-4 list-disc text-sm text-gray-600">
                {step.input_map.map((map: any, i: number) => (
                  <li key={i}>{map.input_key} ← {map.source_step}.{map.source_field}</li>
                ))}
              </ul>
            )}
          </Card>
        ))}
      </div>

      {results.length > 0 && (
        <div className="space-y-6 mt-10">
          <h2 className="text-lg font-semibold">Execution Results</h2>
          {results.map((res, i) => (
            <Card key={i} className="p-4">
              <p className="font-medium">Step {i + 1} — {res.send_status}</p>
              <pre className="mt-2 bg-gray-100 p-2 rounded text-sm overflow-x-auto">
                {JSON.stringify(res.parsed_output, null, 2)}
              </pre>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}