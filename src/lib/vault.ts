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
