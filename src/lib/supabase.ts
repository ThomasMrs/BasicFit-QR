import { createClient } from '@supabase/supabase-js'

const supabaseUrl =
  (import.meta.env.VITE_SUPABASE_URL as string | undefined) ||
  'https://gexqyqebhzuduwlvivny.supabase.co'
const supabaseKey =
  (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) ||
  'sb_publishable_7GRVsRvRdXbb9Umf323i3g_8NgoJDFz'

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseKey)
export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl!, supabaseKey!, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null

export const QR_BUCKET = 'member-qr-vault'
