import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CATEGORY_LABELS, CATEGORY_SLUGS, type CategorySlug } from '@panorist/core/categories';
import { DELIVERY_LABEL } from '@panorist/core/delivery';
import type { PreferencesPatch, UserWithPreferencesWire } from '@panorist/core/types';
import { useSession } from '../auth/session.tsx';
import { useFocusLoad } from '../lib/use-load.ts';
import { Button, Chip, Loading, Notice, Rule, Text } from '../ui/primitives.tsx';
import { space, useTheme } from '../ui/theme.ts';

interface Draft {
  dailyCategories: CategorySlug[];
  weeklyCategories: CategorySlug[];
}

const toDraft = (p: UserWithPreferencesWire): Draft => ({
  dailyCategories: p.dailyCategories,
  weeklyCategories: p.weeklyCategories,
});

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((x) => b.includes(x));

function diff(saved: Draft, draft: Draft): PreferencesPatch {
  const patch: PreferencesPatch = {};
  if (!sameSet(saved.dailyCategories, draft.dailyCategories))
    patch.dailyCategories = draft.dailyCategories;
  if (!sameSet(saved.weeklyCategories, draft.weeklyCategories))
    patch.weeklyCategories = draft.weeklyCategories;
  return patch;
}

type Status = 'idle' | 'saving' | 'saved' | 'error';

export function PreferencesScreen() {
  const { api } = useSession();
  const { state } = useFocusLoad(() => api.getPreferences());
  if (state.status === 'loading') return <Loading />;
  if (state.status === 'error') {
    return (
      <SafeAreaView style={{ flex: 1, padding: space(5) }}>
        <Notice>We couldn’t load your preferences. Check your connection and try again.</Notice>
      </SafeAreaView>
    );
  }
  // Keyed so a fresh load (on focus) resets the form only when the server copy changed.
  return (
    <PreferencesForm key={JSON.stringify(toDraft(state.data))} initial={toDraft(state.data)} />
  );
}

function PreferencesForm({ initial }: { initial: Draft }) {
  const { api } = useSession();
  const { color } = useTheme();
  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState(initial);
  const [status, setStatus] = useState<Status>('idle');

  const patch = diff(saved, draft);
  const dirty = Object.keys(patch).length > 0;
  const paused = draft.dailyCategories.length === 0 && draft.weeklyCategories.length === 0;

  function update(next: Partial<Draft>) {
    setDraft((d) => ({ ...d, ...next }));
    setStatus('idle');
  }

  function toggle(list: 'dailyCategories' | 'weeklyCategories', slug: CategorySlug) {
    const current = draft[list];
    const next = current.includes(slug) ? current.filter((s) => s !== slug) : [...current, slug];
    update({ [list]: CATEGORY_SLUGS.filter((s) => next.includes(s)) });
  }

  async function save() {
    setStatus('saving');
    try {
      const updated = toDraft(await api.updatePreferences(patch));
      setSaved(updated);
      setDraft(updated);
      setStatus('saved');
    } catch (err) {
      console.warn('[preferences] save failed', err);
      setStatus('error');
    }
  }

  const statusLine =
    status === 'saved'
      ? 'Saved. Changes apply from the next delivery.'
      : status === 'error'
        ? 'Couldn’t save. Try again.'
        : paused
          ? 'No topics selected — deliveries are paused.'
          : dirty
            ? 'You have unsaved changes.'
            : `Next editions at ${DELIVERY_LABEL}.`;

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: color.paper }}>
      <ScrollView
        contentContainerStyle={{ padding: space(5), paddingBottom: space(10), gap: space(10) }}
      >
        <View style={{ gap: space(2) }}>
          <Text variant="eyebrow" tone="accent">
            Preferences
          </Text>
          <Text variant="display">Your beats</Text>
          <Text tone="muted">
            Choose the topics for each edition. The daily covers the last day, the weekly the last
            seven.
          </Text>
        </View>

        <Section
          title="The Daily"
          description="Every morning, the last day’s news."
          count={draft.dailyCategories.length}
        >
          <Picker selected={draft.dailyCategories} onToggle={(s) => toggle('dailyCategories', s)} />
        </Section>

        <Section
          title="The Weekly"
          description="Mondays, the stories that shaped the week."
          count={draft.weeklyCategories.length}
        >
          <Picker
            selected={draft.weeklyCategories}
            onToggle={(s) => toggle('weeklyCategories', s)}
          />
        </Section>

        <Section title="Delivery" description={`Both editions arrive at ${DELIVERY_LABEL}.`} />
      </ScrollView>

      <View
        style={{
          borderTopWidth: 1,
          borderTopColor: color.rule,
          backgroundColor: color.paper,
          padding: space(4),
          gap: space(3),
        }}
      >
        <Text variant="small" tone="muted" accessibilityLiveRegion="polite">
          {statusLine}
        </Text>
        <View style={{ flexDirection: 'row', gap: space(2) }}>
          {dirty && (
            <Button
              variant="ghost"
              label="Discard"
              onPress={() => update(saved)}
              style={{ flex: 1 }}
            />
          )}
          <Button
            label="Save changes"
            onPress={save}
            disabled={!dirty}
            busy={status === 'saving'}
            style={{ flex: 2 }}
          />
        </View>
      </View>
    </SafeAreaView>
  );
}

function Section({
  title,
  description,
  count,
  children,
}: {
  title: string;
  description: string;
  count?: number;
  children?: React.ReactNode;
}) {
  return (
    <View style={{ gap: space(3) }}>
      <Rule strong />
      <View
        style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}
      >
        <Text variant="title">{title}</Text>
        {count !== undefined && (
          <Text variant="small" tone="faint">
            {count === 0 ? 'Off' : `${count} ${count === 1 ? 'topic' : 'topics'}`}
          </Text>
        )}
      </View>
      <Text tone="muted">{description}</Text>
      {children && <View style={{ gap: space(2), marginTop: space(1) }}>{children}</View>}
    </View>
  );
}

function Picker({
  selected,
  onToggle,
}: {
  selected: readonly CategorySlug[];
  onToggle: (slug: CategorySlug) => void;
}) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space(2) }}>
      {CATEGORY_SLUGS.map((slug) => (
        <Chip
          key={slug}
          label={CATEGORY_LABELS[slug]}
          selected={selected.includes(slug)}
          onPress={() => onToggle(slug)}
        />
      ))}
    </View>
  );
}
