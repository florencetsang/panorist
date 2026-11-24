/**
 * Fixed delivery schedule. The Vercel Hobby plan allows one cron a day, so
 * every user gets both editions at the same instant: 07:00 Hong Kong time
 * (apps/web/vercel.json runs at 23:00 UTC; Hong Kong has no DST). Dates and
 * the weekly edition's Monday are also reckoned in this zone.
 */

export const DELIVERY_HOUR = 7;
export const DELIVERY_TIMEZONE = 'Asia/Hong_Kong';
export const DELIVERY_LABEL = '07:00 HKT';
