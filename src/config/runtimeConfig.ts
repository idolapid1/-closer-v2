export type ClientDataMode = 'DEMO' | 'PRODUCTION';

export type ClientRuntimeConfig =
  | { mode: 'DEMO' }
  | {
      mode: 'PRODUCTION';
      apiUrl: string;
      supabaseUrl: string;
      supabasePublishableKey: string;
    };

export interface RuntimeEnvironment {
  VITE_CLOSER_DATA_MODE?: string;
  VITE_CLOSER_API_URL?: string;
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  DEV?: boolean;
}

export function loadClientRuntimeConfig(environment: RuntimeEnvironment): ClientRuntimeConfig {
  const mode = environment.VITE_CLOSER_DATA_MODE ?? (environment.DEV ? 'DEMO' : undefined);
  if (mode === 'DEMO') return { mode: 'DEMO' };
  if (mode !== 'PRODUCTION') {
    throw new Error('VITE_CLOSER_DATA_MODE must explicitly be DEMO or PRODUCTION');
  }
  const apiUrl = requireUrl(environment.VITE_CLOSER_API_URL, 'VITE_CLOSER_API_URL');
  const supabaseUrl = requireUrl(environment.VITE_SUPABASE_URL, 'VITE_SUPABASE_URL');
  const supabasePublishableKey = environment.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!supabasePublishableKey || supabasePublishableKey.length < 20) {
    throw new Error('VITE_SUPABASE_PUBLISHABLE_KEY is required in PRODUCTION mode');
  }
  return { mode, apiUrl, supabaseUrl, supabasePublishableKey };
}

function requireUrl(value: string | undefined, field: string): string {
  try {
    if (!value) throw new Error();
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
    return url.toString();
  } catch {
    throw new Error(`${field} must be a valid HTTP(S) URL in PRODUCTION mode`);
  }
}
