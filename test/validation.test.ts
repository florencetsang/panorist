import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { CATEGORY_SLUGS } from '../lib/shared/categories.ts';
import { getUserIdFrom, TEST_USER_ID } from '../lib/shared/user-id.ts';
import {
  isCategoryList,
  isDeliveryHour,
  isPushSubscription,
  isUuid,
  parsePreferencesPatch,
} from '../lib/shared/validation.ts';

const UUID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const SUBSCRIPTION = {
  endpoint: 'https://push.example/x',
  // Real shapes: an 87-char base64url P-256 point and a 22-char auth secret.
  keys: { p256dh: `B${'A'.repeat(86)}`, auth: 'A'.repeat(22) },
};

describe('primitive validators', () => {
  it('isUuid', () => {
    expect(isUuid(UUID)).toBe(true);
    expect(isUuid(UUID.toUpperCase())).toBe(true);
    expect(isUuid('not-a-uuid')).toBe(false);
    expect(isUuid(null)).toBe(false);
  });

  it('isDeliveryHour', () => {
    expect([0, 23].every(isDeliveryHour)).toBe(true);
    expect([-1, 24, 8.5, '8', NaN].some(isDeliveryHour)).toBe(false);
  });

  it('isCategoryList', () => {
    expect(isCategoryList([])).toBe(true);
    expect(isCategoryList(['world', 'sport'])).toBe(true);
    expect(isCategoryList(['world', 'nope'])).toBe(false);
    expect(isCategoryList('world')).toBe(false);
  });

  it('isPushSubscription', () => {
    expect(isPushSubscription(SUBSCRIPTION)).toBe(true);
    expect(isPushSubscription({ ...SUBSCRIPTION, expirationTime: null })).toBe(true);
    expect(isPushSubscription({ ...SUBSCRIPTION, endpoint: '' })).toBe(false);
    expect(isPushSubscription({ endpoint: 'https://x' })).toBe(false);
    expect(isPushSubscription({ ...SUBSCRIPTION, keys: { p256dh: 'p', auth: 'a' } })).toBe(false);
  });
});

describe('parsePreferencesPatch', () => {
  it('accepts a valid partial patch', () => {
    expect(parsePreferencesPatch({ deliveryHour: 7, dailyCategories: [] })).toEqual({
      deliveryHour: 7,
      dailyCategories: [],
    });
    expect(parsePreferencesPatch({ pushSubscription: null })).toEqual({ pushSubscription: null });
  });

  it('rejects unknown keys and invalid values with a message', () => {
    expect(parsePreferencesPatch({ frequency: 'daily' })).toMatch(
      /unknown patch field "frequency"/,
    );
    expect(parsePreferencesPatch({ deliveryHour: 24 })).toMatch(/deliveryHour/);
    expect(parsePreferencesPatch({ weeklyCategories: ['x'] })).toMatch(/weeklyCategories/);
    expect(parsePreferencesPatch({ toString: 1 })).toMatch(/unknown patch field/);
  });
});

describe('getUserIdFrom', () => {
  it('uses a valid ?userId, else the test user', () => {
    expect(getUserIdFrom({ userId: UUID })).toBe(UUID);
    expect(getUserIdFrom({ userId: [UUID, 'x'] })).toBe(UUID);
    expect(getUserIdFrom({ userId: 'garbage' })).toBe(TEST_USER_ID);
    expect(getUserIdFrom({})).toBe(TEST_USER_ID);
  });
});

describe('category vocabulary', () => {
  it('matches every CHECK constraint in the migrations', () => {
    const sql = readdirSync('db/migrations')
      .map((f) => readFileSync(`db/migrations/${f}`, 'utf8'))
      .join('\n');
    const lists = [...sql.matchAll(/ARRAY\[([^\]]+)\]|category IN \(([^)]+)\)/g)].map((m) =>
      (m[1] ?? m[2]).split(',').map((s) => s.trim().replace(/'/g, '')),
    );
    expect(lists.length).toBeGreaterThanOrEqual(3);
    for (const list of lists) expect(list).toEqual([...CATEGORY_SLUGS]);
  });
});
