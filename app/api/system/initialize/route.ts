// app/api/system/initialize/route.ts

import { initializeApplication } from '@/lib/startup/initialize'

export async function POST() {
  try {
    console.log('🔧 System initialization API called')
    
    // Initialize the application
    const result = await initializeApplication()
    
    if (result.success) {
      console.log('✅ System initialization API successful')
      return Response.json({
        success: true,
        message: 'NeuronForge system initialized successfully',
        steps: result.steps,
        timestamp: new Date().toISOString()
      })
    } else {
      console.error('❌ System initialization API failed:', result.error)
      return Response.json({
        success: false,
        error: result.error || 'Initialization failed',
        steps: result.steps
      }, { 
        status: 500 
      })
    }

  } catch (error) {
    console.error('❌ System initialization API error:', error)
    
    return Response.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
      steps: { database: false, cleanup: false, scheduler: false }
    }, { 
      status: 500 
    })
  }
}