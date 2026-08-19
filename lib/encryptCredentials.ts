import crypto from 'crypto'

const ENCRYPTION_SECRET = process.env.ENCRYPTION_SECRET || 'fallback-secret'
const algorithm = 'aes-256-cbc'
const key = crypto.createHash('sha256').update(String(ENCRYPTION_SECRET)).digest()
const iv = Buffer.alloc(16, 0) // Static IV for now (you can improve this later)

export function encryptCredentials(data: { username: string; password: string }) {
  const json = JSON.stringify(data)
  const cipher = crypto.createCipheriv(algorithm, key, iv)
  let encrypted = cipher.update(json, 'utf8', 'hex')
  encrypted += cipher.final('hex')
  return encrypted
}

/**
 * Counterpart to encryptCredentials.
 *
 * NOTE (2026-08-19): this has **no production consumer**. Its only caller was the
 * `GET /api/plugin-connections?plugin_key=…&user_id=…` branch, which returned decrypted
 * credentials to an unauthenticated caller and was deleted during the plugin-route
 * identity hardening. Kept because stored credentials are useless without a decrypt
 * path — a future server-side consumer (a plugin executor reading its own connection)
 * will need it. It must never again be wired to an HTTP response body.
 */
export function decryptCredentials(encrypted: string) {
  const decipher = crypto.createDecipheriv(algorithm, key, iv)
  let decrypted = decipher.update(encrypted, 'hex', 'utf8')
  decrypted += decipher.final('utf8')
  return JSON.parse(decrypted)
}