import { NextResponse } from 'next/server';
import { getRedisConnection } from '@/lib/redis';

export async function GET() {
  try {
    const redis = getRedisConnection();
    
    // Test basic Redis operations
    await redis.set('test-key', 'Hello Redis!');
    const value = await redis.get('test-key');
    
    return NextResponse.json({ 
      success: true, 
      message: 'Redis connection successful!',
      testValue: value 
    });
  } catch (error) {
    console.error('Redis connection error:', error);
    return NextResponse.json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 });
  }
}