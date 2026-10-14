export type MemberData = {
  name: string
  memberNumber: string
  club: string
  guid: string
  deviceId: string
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
  guid: 'ECQ',
  deviceId: '',
  qrSource: '',
  qrPayload: '',
  imagePath: null,
  imageType: null,
})

// Stored profiles can outlive the form version that created them.
export function normalizeMemberData(value: unknown): MemberData {
  const defaults = emptyMemberData()
  if (!value || typeof value !== 'object' || Array.isArray(value)) return defaults

  const stored = value as Record<string, unknown>
  const text = (key: string, fallback = '') => typeof stored[key] === 'string' ? stored[key] as string : fallback

  return {
    name: text('name'),
    memberNumber: typeof stored.memberNumber === 'number' && Number.isFinite(stored.memberNumber)
      ? String(stored.memberNumber)
      : text('memberNumber'),
    club: text('club'),
    guid: text('guid', defaults.guid),
    deviceId: text('deviceId'),
    qrSource: stored.qrSource === 'text' || stored.qrSource === 'image' ? stored.qrSource : '',
    qrPayload: text('qrPayload'),
    imagePath: typeof stored.imagePath === 'string' ? stored.imagePath : null,
    imageType: typeof stored.imageType === 'string' ? stored.imageType : null,
  }
}
