import crypto from 'crypto'

const algorithm = 'aes-256-cbc'
const iv = Buffer.alloc(16, 0) // Static IV for now (you can improve this later)

/**
 * Derives the cipher key from ENCRYPTION_SECRET on every call.
 *
 * Fails closed when unset: an empty value counts as unset and throws. Read at call
 * time, not at module load, so `next build` can collect page data in an environment
 * without the variable, and nothing is cached between calls. Same pattern as
 * `bookingTokenSecret()` in lib/services/bookingToken.ts. The message names the
 * variable only, never a value.
 */
function encryptionKey(): Buffer {
  const configured = process.env.ENCRYPTION_SECRET

  if (!configured) {
    throw new Error('ENCRYPTION_SECRET must be set to encrypt or decrypt plugin credentials')
  }

  return crypto.createHash('sha256').update(configured).digest()
}

export function encryptCredentials(data: { username: string; password: string }) {
  const json = JSON.stringify(data)
  const cipher = crypto.createCipheriv(algorithm, encryptionKey(), iv)
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
  const decipher = crypto.createDecipheriv(algorithm, encryptionKey(), iv)
  let decrypted = decipher.update(encrypted, 'hex', 'utf8')
  decrypted += decipher.final('utf8')
  return JSON.parse(decrypted)
}