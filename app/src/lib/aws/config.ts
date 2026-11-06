// The 1.1 switch: with EXPO_PUBLIC_BACKEND=aws the app talks only to the AWS api at EXPO_PUBLIC_AWS_URL
// (docs/build/contracts/ACCOUNTS.md on aws-migration, "Address"). Off (every build so far, and build 6),
// nothing here is used. EXPO_PUBLIC_API_URL stays Supabase's: build 6 reads it.

export const AWS_ON = (process.env.EXPO_PUBLIC_BACKEND ?? '').trim() === 'aws';

export const AWS_URL = (process.env.EXPO_PUBLIC_AWS_URL ?? '').trim().replace(/\/+$/, '');
