// app/api/system/health/route.ts

export async function GET() {
  try {
    const health = {
      success: true,
      timestamp: new Date().toISOString(),
      details: {
        api: true,
        database: false,
        environment: {
          hasSupabaseUrl: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
          hasSupabaseKey: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
        }
      }
    }

    // Test database connection safely
    try {
      const { supabaseServer } = await import('@/lib/supabaseServer')
      
      if (!supabaseServer || typeof supabaseServer.from !== 'function') {
        throw new Error('Supabase client not properly initialized')
      }

      // Simple connectivity test
      const { error } = await supabaseServer
        .from('agents')
        .select('id')
        .limit(1)

      if (error) {
        throw new Error(`Database query failed: ${error.message}`)
      }

      health.details.database = true

    } catch (dbError) {
      health.success = false
      health.details.database = false
      
      return Response.json({
        ...health,
        error: `Database health check failed: ${dbError instanceof Error ? dbError.message : 'Unknown error'}`
      })
    }

    return Response.json(health)

  } catch (error) {
    console.error('❌ Health check API error:', error)
    
    return Response.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
      timestamp: new Date().toISOString(),
      details: {
        api: false,
        database: false,
        environment: {
          hasSupabaseUrl: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
          hasSupabaseKey: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
        }
      }
    }, { 
      status: 500 
    })
  }
}