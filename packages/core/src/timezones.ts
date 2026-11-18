/** Time zone choices for pickers. */

/** Used when the runtime can't list zones (some mobile JS engines). */
const COMMON_ZONES = [
  'UTC',
  'America/Los_Angeles',
  'America/Denver',
  'America/Chicago',
  'America/New_York',
  'America/Sao_Paulo',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Africa/Johannesburg',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Hong_Kong',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Australia/Sydney',
  'Pacific/Auckland',
];

export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** Every zone the runtime knows, always including `current`. */
export function timeZoneOptions(current?: string): string[] {
  const intl = Intl as typeof Intl & { supportedValuesOf?: (key: 'timeZone') => string[] };
  let zones: string[];
  try {
    zones = intl.supportedValuesOf ? intl.supportedValuesOf('timeZone') : COMMON_ZONES;
  } catch {
    zones = COMMON_ZONES;
  }
  const set = new Set(zones);
  set.add('UTC');
  if (current) set.add(current);
  return [...set].sort();
}

/** "Asia/Hong_Kong" → "Hong Kong (Asia)". */
export function timeZoneLabel(zone: string): string {
  const parts = zone.split('/');
  if (parts.length === 1) return zone;
  const city = parts.at(-1)!.replace(/_/g, ' ');
  return `${city} (${parts.slice(0, -1).join(' / ').replace(/_/g, ' ')})`;
}
