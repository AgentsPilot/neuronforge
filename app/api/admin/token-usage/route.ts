// app/api/admin/token-usage/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY! // Use service role for admin access
);

// Mark as dynamic since it uses request.url and searchParams
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const filter = searchParams.get('filter') || 'all';
    const provider = searchParams.get('provider') || 'all';
    const search = searchParams.get('search') || '';
    const dateFrom = searchParams.get('dateFrom');
    const dateTo = searchParams.get('dateTo');

    console.log('Token usage API called with params:', { filter, provider, search, dateFrom, dateTo });

    // Start with a basic query without JOINs to avoid potential issues
    let query = supabase
      .from('token_usage')
      .select('*')
      .order('created_at', { ascending: false });

    // Apply filters
    if (filter !== 'all') {
      if (filter === 'success') {
        query = query.eq('success', true);
      } else if (filter === 'error') {
        query = query.eq('success', false);
      } else {
        query = query.eq('request_type', filter);
      }
    }

    if (provider !== 'all') {
      query = query.eq('provider', provider);
    }

    // Apply date range filters
    if (dateFrom) {
      query = query.gte('created_at', dateFrom);
    }
    if (dateTo) {
      query = query.lte('created_at', dateTo);
    }

    // Apply basic search filter (no JOINs)
    if (search && search.trim() !== '') {
      query = query.or(`
        request_type.ilike.%${search}%,
        model_name.ilike.%${search}%,
        provider.ilike.%${search}%,
        feature.ilike.%${search}%,
        activity_name.ilike.%${search}%,
        component.ilike.%${search}%,
        category.ilike.%${search}%
      `);
    }

    const { data: tokenUsage, error: queryError } = await query.limit(1000);

    if (queryError) {
      console.error('Database query error:', queryError);
      return NextResponse.json({ 
        error: 'Failed to fetch token usage data',
        details: queryError.message 
      }, { status: 500 });
    }

    console.log(`Fetched ${tokenUsage?.length || 0} token usage records`);

    // Try to enrich data with user profiles separately if possible
    let enrichedData = tokenUsage || [];
    
    if (tokenUsage && tokenUsage.length > 0) {
      try {
        // Get unique user IDs
        const userIds = [...new Set(tokenUsage.map(record => record.user_id).filter(Boolean))];
        
        // Try to fetch user profiles
        if (userIds.length > 0) {
          const { data: profiles } = await supabase
            .from('profiles')
            .select('id, full_name, company')
            .in('id', userIds);

          if (profiles && profiles.length > 0) {
            // Enrich the data with profile information
            enrichedData = tokenUsage.map(record => ({
              ...record,
              profiles: profiles.find(profile => profile.id === record.user_id) || null
            }));
            console.log(`Enriched data with ${profiles.length} user profiles`);
          }
        }
      } catch (enrichError) {
        console.log('Could not enrich with profile data, continuing with basic data:', enrichError);
        // Continue with basic data if enrichment fails
      }
    }

    // Calculate aggregated statistics using correct column names
    const stats = {
      totalTokens: enrichedData?.reduce((sum, record) => sum + (record.total_tokens || 0), 0) || 0,
      totalCost: enrichedData?.reduce((sum, record) => sum + (record.cost_usd || 0), 0) || 0,
      totalRequests: enrichedData?.length || 0,
      averageLatency: 0,
      successRate: 0,
      byProvider: {} as Record<string, { tokens: number; cost: number; requests: number }>,
      byOperation: {} as Record<string, { tokens: number; cost: number; requests: number }>
    };

    // Calculate success rate
    const successfulRequests = enrichedData?.filter(record => record.success).length || 0;
    stats.successRate = stats.totalRequests > 0 ? (successfulRequests / stats.totalRequests) * 100 : 0;

    // Calculate average latency if available
    const recordsWithLatency = enrichedData?.filter(record => record.latency_ms) || [];
    if (recordsWithLatency.length > 0) {
      stats.averageLatency = recordsWithLatency.reduce((sum, record) => sum + record.latency_ms, 0) / recordsWithLatency.length;
    }

    // Group by provider and operation using correct column names
    enrichedData?.forEach(record => {
      const provider = record.provider || 'unknown';
      const operation = record.request_type || 'unknown';

      // By provider
      if (!stats.byProvider[provider]) {
        stats.byProvider[provider] = { tokens: 0, cost: 0, requests: 0 };
      }
      stats.byProvider[provider].tokens += record.total_tokens || 0;
      stats.byProvider[provider].cost += record.cost_usd || 0;
      stats.byProvider[provider].requests += 1;

      // By operation
      if (!stats.byOperation[operation]) {
        stats.byOperation[operation] = { tokens: 0, cost: 0, requests: 0 };
      }
      stats.byOperation[operation].tokens += record.total_tokens || 0;
      stats.byOperation[operation].cost += record.cost_usd || 0;
      stats.byOperation[operation].requests += 1;
    });

    console.log(`Successfully processed ${enrichedData?.length || 0} token usage records`);

    return NextResponse.json({
      success: true,
      data: enrichedData || [],
      stats,
      pagination: {
        total: enrichedData?.length || 0,
        page: 1,
        limit: 1000
      }
    });

  } catch (error) {
    console.error('Token usage API error:', error);
    return NextResponse.json({ 
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

// Health check endpoint
export async function HEAD() {
  return new NextResponse(null, { status: 200 });
}