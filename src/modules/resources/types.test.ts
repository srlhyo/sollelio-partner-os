import { describe, expect, it } from 'vitest';
import { resourceHost } from './types';

describe('resourceHost', () => {
  it('shows the host a partner would recognise', () => {
    expect(resourceHost('https://events.sollelio.com/doluxoamesa/eventos')).toBe('events.sollelio.com');
  });

  it('keeps the port when there is one', () => {
    expect(resourceHost('http://127.0.0.1:5173/partner')).toBe('127.0.0.1:5173');
  });

  it('falls back to the raw value rather than throwing', () => {
    expect(resourceHost('nao-e-um-url')).toBe('nao-e-um-url');
  });
});
