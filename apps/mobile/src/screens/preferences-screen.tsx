import { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, ScrollView, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CATEGORY_LABELS, CATEGORY_SLUGS, type CategorySlug } from '@panorist/core/categories';
import { hourLabel } from '@panorist/core/format';
import { deviceTimeZone, timeZoneLabel, timeZoneOptions } from '@panorist/core/timezones';
import type { PreferencesPatch, UserWithPreferencesWire } from '@panorist/core/types';
import { useSession } from '../auth/session.tsx';
import { useFocusLoad } from '../lib/use-load.ts';
import { Button, Chip, Loading, Notice, Rule, Text } from '../ui/primitives.tsx';
import { font, radius, space, useTheme } from '../ui/theme.ts';

interface Draft {
  dailyCategories: CategorySlug[];
  weeklyCategories: CategorySlug[];
  deliveryHour: number;
  timezone: string;
}

const toDraft = (p: UserWithPreferencesWire): Draft => ({
  dailyCategories: p.dailyCategories,
  weeklyCategories: p.weeklyCategories,
  deliveryHour: p.deliveryHour,
  timezone: p.timezone,
});

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((x) => b.includes(x));

function diff(saved: Draft, draft: Draft): PreferencesPatch {
  const patch: PreferencesPatch = {};
  if (!sameSet(saved.dailyCategories, draft.dailyCategories))
    patch.dailyCategories = draft.dailyCategories;
  if (!sameSet(saved.weeklyCategories, draft.weeklyCategories))
    patch.weeklyCategories = draft.weeklyCategories;
  if (saved.deliveryHour !== draft.deliveryHour) patch.deliveryHour = draft.deliveryHour;
  if (saved.timezone !== draft.timezone) patch.timezone = draft.timezone;
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
  const [pickingZone, setPickingZone] = useState(false);
  const device = deviceTimeZone();

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
            : `Next editions at ${hourLabel(draft.deliveryHour)}.`;

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

        <Section title="Delivery" description="Both editions arrive at the same local hour.">
          <Text variant="small" style={{ fontFamily: font.sansMedium }}>
            Time
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: space(2) }}
            contentOffset={{ x: Math.max(0, draft.deliveryHour - 2) * 78, y: 0 }}
          >
            {Array.from({ length: 24 }, (_, h) => (
              <Chip
                key={h}
                label={hourLabel(h)}
                selected={draft.deliveryHour === h}
                onPress={() => update({ deliveryHour: h })}
              />
            ))}
          </ScrollView>

          <Text variant="small" style={{ fontFamily: font.sansMedium, marginTop: space(4) }}>
            Time zone
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => setPickingZone(true)}
            style={{
              borderWidth: 1,
              borderColor: color.rule,
              backgroundColor: color.surface,
              borderRadius: radius.md,
              padding: space(4),
              flexDirection: 'row',
              justifyContent: 'space-between',
            }}
          >
            <Text>{timeZoneLabel(draft.timezone)}</Text>
            <Text tone="faint">Change</Text>
          </Pressable>
          {device !== draft.timezone && (
            <Pressable onPress={() => update({ timezone: device })} hitSlop={8}>
              <Text variant="small" tone="accent">
                Use this device’s time zone ({timeZoneLabel(device)})
              </Text>
            </Pressable>
          )}
        </Section>
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

      <ZonePicker
        visible={pickingZone}
        current={draft.timezone}
        onClose={() => setPickingZone(false)}
        onPick={(zone) => {
          update({ timezone: zone });
          setPickingZone(false);
        }}
      />
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
  children: React.ReactNode;
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
      <View style={{ gap: space(2), marginTop: space(1) }}>{children}</View>
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

function ZonePicker({
  visible,
  current,
  onClose,
  onPick,
}: {
  visible: boolean;
  current: string;
  onClose: () => void;
  onPick: (zone: string) => void;
}) {
  const { color } = useTheme();
  const [query, setQuery] = useState('');
  const zones = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/\s+/g, '_');
    return timeZoneOptions(current).filter((z) => !q || z.toLowerCase().includes(q));
  }, [query, current]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView style={{ flex: 1, backgroundColor: color.paper }}>
        <View style={{ padding: space(5), gap: space(4) }}>
          <View
            style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
          >
            <Text variant="title">Time zone</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Text tone="muted" style={{ fontFamily: font.sansMedium }}>
                Done
              </Text>
            </Pressable>
          </View>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search cities"
            placeholderTextColor={color.inkFaint}
            autoCorrect={false}
            style={{
              borderWidth: 1,
              borderColor: color.rule,
              backgroundColor: color.surface,
              borderRadius: radius.md,
              padding: space(3.5),
              fontFamily: font.sans,
              fontSize: 16,
              color: color.ink,
            }}
          />
        </View>
        <FlatList
          data={zones}
          keyExtractor={(z) => z}
          keyboardShouldPersistTaps="handled"
          ItemSeparatorComponent={() => <Rule style={{ marginLeft: space(5) }} />}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => onPick(item)}
              style={({ pressed }) => ({
                paddingHorizontal: space(5),
                paddingVertical: space(3.5),
                flexDirection: 'row',
                justifyContent: 'space-between',
                backgroundColor: pressed ? color.sunken : 'transparent',
              })}
            >
              <Text>{timeZoneLabel(item)}</Text>
              {item === current && <Text tone="accent">✓</Text>}
            </Pressable>
          )}
        />
      </SafeAreaView>
    </Modal>
  );
}
