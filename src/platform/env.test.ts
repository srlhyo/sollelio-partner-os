import { describe, expect, it } from 'vitest';
import { EnvConfigError, readClientEnv } from './env';

const valid = {
  VITE_SUPABASE_URL: 'https://partner-os.supabase.co',
  VITE_SUPABASE_ANON_KEY: 'anon-key',
  VITE_APP_ENV: 'staging',
};

describe('readClientEnv', () => {
  it('accepts a complete configuration', () => {
    expect(readClientEnv(valid)).toEqual({
      supabaseUrl: 'https://partner-os.supabase.co',
      supabaseAnonKey: 'anon-key',
      appEnv: 'staging',
    });
  });

  it('fails fast when a variable is missing', () => {
    expect(() => readClientEnv({ ...valid, VITE_SUPABASE_ANON_KEY: undefined })).toThrow(
      EnvConfigError,
    );
  });

  it('fails fast when a variable is blank', () => {
    expect(() => readClientEnv({ ...valid, VITE_SUPABASE_URL: '   ' })).toThrow(EnvConfigError);
  });

  it('rejects an unknown environment name', () => {
    expect(() => readClientEnv({ ...valid, VITE_APP_ENV: 'prod' })).toThrow(/VITE_APP_ENV/);
  });

  it('rejects a malformed Supabase URL', () => {
    expect(() => readClientEnv({ ...valid, VITE_SUPABASE_URL: 'not-a-url' })).toThrow(/valid URL/);
  });
});
