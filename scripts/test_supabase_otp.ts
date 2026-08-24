import { getSupabaseClient } from '@/storage/database/supabase-client'

async function test() {
  const supabase = getSupabaseClient()
  const email = 'ceshiboy001@outlook.com'
  console.log('Sending OTP to:', email)
  const { data, error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false }
  })
  console.log('data:', JSON.stringify(data, null, 2))
  console.log('error:', error ? JSON.stringify(error, null, 2) : 'null')
}
test()
