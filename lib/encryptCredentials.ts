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

export function decryptCredentials(encrypted: string) {
  const decipher = crypto.createDecipheriv(algorithm, key, iv)
  let decrypted = decipher.update(encrypted, 'hex', 'utf8')
  decrypted += decipher.final('utf8')
  return JSON.parse(decrypted)
}