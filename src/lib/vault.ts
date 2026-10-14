const encoder = new TextEncoder()
const decoder = new TextDecoder()
const SALT_LENGTH = 16
const IV_LENGTH = 12
const PBKDF2_ITERATIONS = 310_000

export type MemberData = {
  name: string
  memberNumber: string
  club: string
  qrSource: 'text' | 'image' | ''
  qrPayload: string
  imagePath: string | null
  imageType: string | null
}

export type VaultEnvelope = {
  user_id: string
  salt: string
  iv: string
  ciphertext: string
  updated_at?: string
}

export const emptyMemberData = (): MemberData => ({
  name: '',
  memberNumber: '',
  club: '',
  qrSource: '',
  qrPayload: '',
  imagePath: null,
  imageType: null,
})

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value)
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

export function createSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(SALT_LENGTH))
}

export async function deriveVaultKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', encoder.encode(passphrase), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export async function encryptText(value: string, key: CryptoKey): Promise<{ iv: string; ciphertext: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH))
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(value))
  return { iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(ciphertext)) }
}

export async function decryptText(envelope: Pick<VaultEnvelope, 'iv' | 'ciphertext'>, key: CryptoKey): Promise<string> {
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(envelope.iv) },
    key,
    fromBase64(envelope.ciphertext),
  )
  return decoder.decode(plaintext)
}

export async function encryptBytes(bytes: ArrayBuffer, key: CryptoKey): Promise<Blob> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH))
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes))
  const packed = new Uint8Array(IV_LENGTH + ciphertext.length)
  packed.set(iv, 0)
  packed.set(ciphertext, IV_LENGTH)
  return new Blob([packed], { type: 'application/octet-stream' })
}

export async function decryptBytes(blob: Blob, key: CryptoKey): Promise<ArrayBuffer> {
  const packed = new Uint8Array(await blob.arrayBuffer())
  if (packed.length <= IV_LENGTH) throw new Error('Fichier chiffré incomplet.')
  const iv = packed.slice(0, IV_LENGTH)
  const ciphertext = packed.slice(IV_LENGTH)
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext)
}

export function decodeSalt(salt: string): Uint8Array {
  return fromBase64(salt)
}

export function encodeSalt(salt: Uint8Array): string {
  return toBase64(salt)
}

