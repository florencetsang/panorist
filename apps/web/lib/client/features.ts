/**
 * The caller's AI features, fetched once per page load and shared by every
 * component. Until it loads (or if it fails) everything AI stays hidden, so
 * the basic app is unchanged.
 */

import { useEffect, useState } from 'react';

import type { FeatureKey } from '@panorist/core/features';
import type { FeaturesWire } from '@panorist/core/types';
import { api } from './api.ts';

let pending: Promise<FeaturesWire | null> | null = null;

function loadFeatures(): Promise<FeaturesWire | null> {
  pending ??= api.getFeatures().catch((err: unknown) => {
    console.error('[features] load failed', err);
    pending = null;
    return null;
  });
  return pending;
}

export function useFeatures(): { has: (key: FeatureKey) => boolean; loaded: boolean } {
  const [features, setFeatures] = useState<FeaturesWire | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void loadFeatures().then((value) => {
      if (cancelled) return;
      setFeatures(value);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return { has: (key) => features?.features.includes(key) ?? false, loaded };
}
