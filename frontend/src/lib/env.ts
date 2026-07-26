function getRequiredEnv(name: string, value: string | undefined) {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }

  return value
}

export const env = {
  apiBaseUrl: getRequiredEnv(
    'VITE_API_BASE_URL',
    import.meta.env.VITE_API_BASE_URL
  ),
  supabaseUrl: getRequiredEnv(
    'VITE_SUPABASE_URL',
    import.meta.env.VITE_SUPABASE_URL
  ),
  supabasePublishableKey: getRequiredEnv(
    'VITE_SUPABASE_PUBLISHABLE_KEY',
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
  ),
  // Optional until PolicyNFT is deployed. A missing address disables the mint
  // action without making read-only policy pages fail at application boot.
  policyNftAddress: (import.meta.env.VITE_POLICY_NFT_ADDRESS ?? '').trim(),
}
