import { describe, expect, it } from 'vitest';
import { getSupabaseAuthClient } from './SupabaseAuthClient';

describe('SupabaseAuthClient factory', () => {
  it('reuses one GoTrue client for the same production project configuration', () => {
    const first = getSupabaseAuthClient(
      'https://strict-mode.supabase.co',
      'sb_publishable_strict_mode_test_key',
    );
    const second = getSupabaseAuthClient(
      'https://strict-mode.supabase.co',
      'sb_publishable_strict_mode_test_key',
    );
    expect(second).toBe(first);
  });
});
