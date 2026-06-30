import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { SystemConfigService } from '@/lib/services/SystemConfigService'
import {
  getCalibrationEmailConfig,
  CALIBRATION_EMAIL_PROVIDER_KEY,
  CALIBRATION_EMAIL_MODEL_KEY,
} from '@/lib/calibration/CalibrationEmailConfigService'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/calibration-email-config
 * Current provider/model for the calibration result email (defaults centralized
 * in CalibrationEmailConfigService).
 */
export async function GET() {
  try {
    const config = await getCalibrationEmailConfig(supabase)
    return NextResponse.json({ success: true, config })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}

/**
 * PUT /api/admin/calibration-email-config
 * Update provider/model. Body: { config: { provider, model } }
 */
export async function PUT(request: NextRequest) {
  try {
    const { config } = await request.json()
    if (!config || typeof config !== 'object') {
      return NextResponse.json({ success: false, error: 'Config object required' }, { status: 400 })
    }

    const updates: Record<string, any> = {}
    if (typeof config.provider === 'string' && config.provider.trim()) {
      updates[CALIBRATION_EMAIL_PROVIDER_KEY] = config.provider.trim()
    }
    if (typeof config.model === 'string' && config.model.trim()) {
      updates[CALIBRATION_EMAIL_MODEL_KEY] = config.model.trim()
    }
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ success: false, error: 'Provide provider and/or model' }, { status: 400 })
    }

    await SystemConfigService.setMultiple(supabase, updates)
    return NextResponse.json({ success: true, message: 'Calibration email config updated' })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}
