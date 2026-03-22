// Preload environment variables before any module imports.
// Usage: npx tsx --import ./scripts/env-preload.ts scripts/your-script.ts
import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.join(process.cwd(), '.env.local') })
