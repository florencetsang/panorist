import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, View, type ScrollViewInstance } from 'react-native';

import { ApiError } from '@panorist/core/api';
import { categoryLabel } from '@panorist/core/categories';
import { deliveredLabel, frequencyLabel, periodLabel, readingMinutes } from '@panorist/core/format';
import type { HydratedReportWire } from '@panorist/core/types';
import { useSession } from '../auth/session.tsx';
import { Markdown } from '../ui/markdown.tsx';
import { Button, Chip, Loading, Notice, Rule, Text } from '../ui/primitives.tsx';
import { font, space, useTheme } from '../ui/theme.ts';

type State =
  | { status: 'loading' }
  | { status: 'missing' }
  | { status: 'error' }
  | { status: 'ready'; report: HydratedReportWire };

export function ReaderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api } = useSession();
  const { color } = useTheme();
  const router = useRouter();
  const [state, setState] = useState<State>({ status: 'loading' });
  const [saving, setSaving] = useState(false);
  const scroll = useRef<ScrollViewInstance>(null);
  const offsets = useRef<Record<string, number>>({});

  useEffect(() => {
    let cancelled = false;
    api.getReport(id).then(
      async (report) => {
        if (cancelled) return;
        setState({ status: 'ready', report });
        if (report.readAt !== null) return;
        try {
          const { readAt } = await api.setReportRead(report.id, true);
          if (!cancelled) setState({ status: 'ready', report: { ...report, readAt } });
        } catch (err) {
          console.warn('[reader] mark read failed', err);
        }
      },
      (err) => {
        if (cancelled) return;
        setState({ status: err instanceof ApiError && err.status === 404 ? 'missing' : 'error' });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [api, id]);

  if (state.status === 'loading') return <Loading />;
  if (state.status !== 'ready') {
    return (
      <View style={{ flex: 1, padding: space(6), gap: space(4), justifyContent: 'center' }}>
        {state.status === 'missing' ? (
          <>
            <Text variant="title">Briefing not found</Text>
            <Text tone="muted">It may have been removed, or the link is wrong.</Text>
          </>
        ) : (
          <Notice>We couldn’t load this briefing. Check your connection and try again.</Notice>
        )}
        <Button variant="secondary" label="Back to briefings" onPress={() => router.back()} />
      </View>
    );
  }

  const { report } = state;
  const topics = report.topics.filter((t) => t.markdown.trim().length > 0);
  const minutes = readingMinutes(topics.map((t) => t.markdown).join('\n'));

  async function toggleRead() {
    setSaving(true);
    try {
      const { readAt } = await api.setReportRead(report.id, report.readAt === null);
      setState({ status: 'ready', report: { ...report, readAt } });
    } catch (err) {
      console.warn('[reader] toggle read failed', err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Pressable onPress={toggleRead} disabled={saving} hitSlop={10}>
              <Text tone="muted" style={{ fontFamily: font.sansMedium, opacity: saving ? 0.5 : 1 }}>
                Mark {report.readAt === null ? 'read' : 'unread'}
              </Text>
            </Pressable>
          ),
        }}
      />
      <ScrollView
        ref={scroll}
        style={{ backgroundColor: color.paper }}
        contentContainerStyle={{ padding: space(5), paddingBottom: space(16) }}
      >
        <View style={{ gap: space(3) }}>
          <Text variant="eyebrow" tone="accent">
            {frequencyLabel(report.frequency)}
          </Text>
          <Text variant="display">{periodLabel(report)}</Text>
          <Text variant="small" tone="muted">
            {topics.length} {topics.length === 1 ? 'topic' : 'topics'} · {minutes} min read ·{' '}
            {deliveredLabel(report.createdAt)}
          </Text>
          <Rule strong style={{ marginTop: space(2) }} />
        </View>

        {topics.length > 1 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: space(2), paddingVertical: space(4) }}
          >
            {topics.map((t) => (
              <Chip
                key={t.category}
                label={categoryLabel(t.category)}
                selected={false}
                onPress={() =>
                  scroll.current?.scrollTo({ y: (offsets.current[t.category] ?? 0) - space(2) })
                }
              />
            ))}
          </ScrollView>
        )}

        {topics.length === 0 ? (
          <Text tone="muted" style={{ marginTop: space(8) }}>
            This briefing’s content is no longer available.
          </Text>
        ) : (
          topics.map((t, i) => (
            <View
              key={t.category}
              onLayout={(e) => {
                offsets.current[t.category] = e.nativeEvent.layout.y;
              }}
              style={{ paddingTop: space(8), gap: space(5) }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space(3) }}>
                <Text variant="heading" tone="accent" style={{ fontFamily: font.serif }}>
                  {String(i + 1).padStart(2, '0')}
                </Text>
                <Text variant="title">{categoryLabel(t.category)}</Text>
              </View>
              <Markdown source={t.markdown} />
            </View>
          ))
        )}

        <View style={{ marginTop: space(14), alignItems: 'center', gap: space(5) }}>
          <Rule style={{ alignSelf: 'stretch' }} />
          <Text variant="heading" tone="muted" style={{ fontFamily: font.serifItalic }}>
            That’s the briefing.
          </Text>
          <Button variant="secondary" label="Back to all briefings" onPress={() => router.back()} />
        </View>
      </ScrollView>
    </>
  );
}
