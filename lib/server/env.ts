/**
 * Centralized server configuration. Values are read lazily so modules can be
 * imported (by tests and scripts) without every variable being set; each
 * accessor fails with a clear message when its variables are missing.
 * See .env.example for what each variable means.
 */

import 'server-only';

function readRequired(names: readonly string[], feature: string): string[] {
  const missing = names.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(`${feature}: missing ${missing.join(', ')} — see .env.example`);
  }
  return names.map((name) => process.env[name] as string);
}

function readFlag(name: string): boolean {
  const value = process.env[name];
  return value === '1' || value === 'true';
}

export const env = {
  databaseUrl(): string {
    const [url] = readRequired(['DATABASE_URL'], 'Database');
    return url;
  },

  llm(): { baseUrl: string; apiKey: string; model: string } {
    const [baseUrl, apiKey, model] = readRequired(
      ['LLM_BASE_URL', 'LLM_API_KEY', 'LLM_MODEL'],
      'LLM',
    );
    return { baseUrl, apiKey, model };
  },

  vapid(): { publicKey: string; privateKey: string; subject: string } {
    const [publicKey, privateKey, subject] = readRequired(
      ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT'],
      'Web push',
    );
    return { publicKey, privateKey, subject };
  },

  vapidPublicKey(): string | null {
    return process.env.VAPID_PUBLIC_KEY || null;
  },

  /** Null when unset — callers must fail closed. */
  cronSecret(): string | null {
    return process.env.CRON_SECRET || null;
  },

  cronDbLogs(): boolean {
    return readFlag('CRON_DB_LOGS');
  },

  /**
   * Origin of the production alias on Vercel (VERCEL_PROJECT_PRODUCTION_URL),
   * or null locally. See app/api/cron/route.ts for why the cron must
   * not call its own deployment URL.
   */
  productionOrigin(): string | null {
    const domain = process.env.VERCEL_PROJECT_PRODUCTION_URL?.replace(/^https?:\/\//, '');
    return domain ? `https://${domain}` : null;
  },
};
