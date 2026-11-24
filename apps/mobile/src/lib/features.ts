import { useEffect, useState } from 'react';

import type { FeatureKey } from '@panorist/core/features';
import type { FeaturesWire } from '@panorist/core/types';
import { useSession } from '../auth/session.tsx';

/**
 * The signed-in user's AI features, fetched on mount. Until it loads (or if
 * it fails) everything AI stays hidden, so the basic app is unchanged.
 */
export function useFeatures(): { has: (key: FeatureKey) => boolean } {
  const { api } = useSession();
  const [features, setFeatures] = useState<FeaturesWire | null>(null);
  useEffect(() => {
    let cancelled = false;
    api.getFeatures().then(
      (value) => !cancelled && setFeatures(value),
      (err) => console.warn('[features] load failed', err),
    );
    return () => {
      cancelled = true;
    };
  }, [api]);
  return { has: (key) => features?.features.includes(key) ?? false };
}
