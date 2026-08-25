import { describe, expect, it } from 'vitest';
import { loadClientRuntimeConfig } from './runtimeConfig';

describe('production client runtime configuration', () => {
  it('allows implicit demo mode only during local development', () => {
    expect(loadClientRuntimeConfig({ DEV: true })).toEqual({ mode: 'DEMO' });
    expect(() => loadClientRuntimeConfig({ DEV: false })).toThrow(/explicitly/);
    expect(() => loadClientRuntimeConfig({ VITE_CLOSER_DATA_MODE: 'something' })).toThrow(/explicitly/);
  });

  it('fails closed when any public production endpoint is missing', () => {
    expect(() => loadClientRuntimeConfig({ VITE_CLOSER_DATA_MODE: 'PRODUCTION' })).toThrow(/VITE_CLOSER_API_URL/);
    expect(() => loadClientRuntimeConfig({
      VITE_CLOSER_DATA_MODE: 'PRODUCTION',
      VITE_CLOSER_API_URL: 'https://api.example.test',
      VITE_SUPABASE_URL: 'https://project.supabase.co',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'short',
    })).toThrow(/PUBLISHABLE_KEY/);
  });

  it('creates an explicit production configuration without server secrets', () => {
    expect(loadClientRuntimeConfig({
      VITE_CLOSER_DATA_MODE: 'PRODUCTION',
      VITE_CLOSER_API_URL: 'https://api.example.test',
      VITE_SUPABASE_URL: 'https://project.supabase.co',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_abcdefghijklmnopqrstuvwxyz',
    })).toEqual({
      mode: 'PRODUCTION',
      apiUrl: 'https://api.example.test/',
      supabaseUrl: 'https://project.supabase.co/',
      supabasePublishableKey: 'sb_publishable_abcdefghijklmnopqrstuvwxyz',
    });
  });
});
