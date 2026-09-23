import { describe, expect, it } from 'vitest';
import {
  INTERNAL_HOME,
  PARTNER_HOME,
  isSafeAppPath,
  resolveDestination,
  roleOf,
  surfaceOfPath,
} from './destination';

describe('resolveDestination', () => {
  it('1. sends a partner with no requested destination home', () => {
    expect(resolveDestination('partner', null)).toBe(PARTNER_HOME);
    expect(resolveDestination('partner', undefined)).toBe(PARTNER_HOME);
  });

  it('2. sends staff with no requested destination to the internal home', () => {
    expect(resolveDestination('staff', null)).toBe(INTERNAL_HOME);
  });

  it('3. keeps a partner destination for a partner', () => {
    expect(resolveDestination('partner', '/partner/resources')).toBe('/partner/resources');
    expect(resolveDestination('partner', '/partner')).toBe('/partner');
  });

  it('4. keeps an internal destination for staff', () => {
    expect(resolveDestination('staff', '/app/organizations/do-luxo-a-mesa')).toBe(
      '/app/organizations/do-luxo-a-mesa',
    );
    expect(resolveDestination('staff', '/app/organizations/do-luxo-a-mesa/people')).toBe(
      '/app/organizations/do-luxo-a-mesa/people',
    );
  });

  it('5. ignores a partner destination requested for staff', () => {
    expect(resolveDestination('staff', '/partner/resources')).toBe(INTERNAL_HOME);
    expect(resolveDestination('staff', '/partner')).toBe(INTERNAL_HOME);
  });

  it('6. ignores an internal destination requested for a partner', () => {
    expect(resolveDestination('partner', '/app/organizations')).toBe(PARTNER_HOME);
    expect(resolveDestination('partner', '/app/organizations/do-luxo-a-mesa/people')).toBe(
      PARTNER_HOME,
    );
  });

  it('7. falls back to the role home for anything malformed or off-origin', () => {
    const hostile = [
      '',
      'partner',
      '//evil.example',
      'https://evil.example/partner',
      'http://evil.example',
      'javascript:alert(1)',
      '/\\evil.example',
      '/partner\\..\\app',
      '\u0000/partner',
    ];

    for (const value of hostile) {
      expect(resolveDestination('partner', value)).toBe(PARTNER_HOME);
      expect(resolveDestination('staff', value)).toBe(INTERNAL_HOME);
    }
  });

  it('never lands back on an auth screen, which would loop', () => {
    expect(resolveDestination('partner', '/partner/sign-in')).toBe(PARTNER_HOME);
    expect(resolveDestination('partner', '/partner/check-email')).toBe(PARTNER_HOME);
    expect(resolveDestination('staff', '/partner/link-expired')).toBe(INTERNAL_HOME);
  });

  it('resolves to a destination that is itself already allowed, so it cannot loop', () => {
    for (const role of ['partner', 'staff'] as const) {
      const once = resolveDestination(role, null);
      expect(resolveDestination(role, once)).toBe(once);
    }
  });

  it('keeps a query string on an otherwise allowed destination', () => {
    expect(resolveDestination('partner', '/partner/resources?org=do-luxo-a-mesa')).toBe(
      '/partner/resources?org=do-luxo-a-mesa',
    );
  });
});

describe('roleOf', () => {
  it('treats a missing profile as the lesser privilege', () => {
    expect(roleOf(null)).toBe('partner');
    expect(roleOf(undefined)).toBe('partner');
    expect(roleOf({ isSollelioStaff: false })).toBe('partner');
    expect(roleOf({ isSollelioStaff: true })).toBe('staff');
  });
});

describe('surfaceOfPath', () => {
  it('maps each surface, and nothing else', () => {
    expect(surfaceOfPath('/partner')).toBe('partner');
    expect(surfaceOfPath('/partner/resources')).toBe('partner');
    expect(surfaceOfPath('/app')).toBe('internal');
    expect(surfaceOfPath('/app/organizations')).toBe('internal');
    expect(surfaceOfPath('/')).toBeNull();
    expect(surfaceOfPath('/partnership')).toBeNull();
    expect(surfaceOfPath('/application')).toBeNull();
  });
});

describe('isSafeAppPath', () => {
  it('accepts in-app paths only', () => {
    expect(isSafeAppPath('/partner')).toBe(true);
    expect(isSafeAppPath('//evil.example')).toBe(false);
    expect(isSafeAppPath('https://evil.example')).toBe(false);
    expect(isSafeAppPath('')).toBe(false);
    expect(isSafeAppPath(null)).toBe(false);
  });
});
