import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, RefreshControl, SectionList, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { categoryLabel } from '@panorist/core/categories';
import {
  deliveredLabel,
  frequencyLabel,
  greeting,
  groupByMonth,
  hourLabel,
  mastheadDate,
  periodLabel,
  reportHeadline,
} from '@panorist/core/format';
import type { ReportWire, UserWithPreferencesWire } from '@panorist/core/types';
import { useSession } from '../auth/session.tsx';
import { useFocusLoad } from '../lib/use-load.ts';
import { Button, Chip, Loading, Notice, Rule, Text, Wordmark } from '../ui/primitives.tsx';
import { font, radius, space, useTheme } from '../ui/theme.ts';

type Filter = 'all' | 'unread' | 'daily' | 'weekly';
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'unread', label: 'Unread' },
  { id: 'daily', label: 'Daily' },
  { id: 'weekly', label: 'Weekly' },
];

const categoriesOf = (r: ReportWire) => r.content.map((c) => c.category);

export function BriefingsScreen() {
  const { api, session } = useSession();
  const { color } = useTheme();
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>('all');
  const { state, refresh } = useFocusLoad(async () => {
    const [reports, prefs] = await Promise.all([api.getReports(), api.getPreferences()]);
    return { reports, prefs };
  });

  const reports = state.status === 'ready' ? state.data.reports : [];
  const [lead, ...rest] = reports;
  const sections = useMemo(() => {
    const shown = rest.filter((r) =>
      filter === 'all' ? true : filter === 'unread' ? r.readAt === null : r.frequency === filter,
    );
    return groupByMonth(shown).map((g) => ({ title: g.month, data: g.items }));
  }, [rest, filter]);

  if (state.status === 'loading') return <Loading />;

  const unread = reports.filter((r) => r.readAt === null).length;
  const firstName = session?.user.name?.split(' ')[0];
  const open = (id: string) => router.push({ pathname: '/reports/[id]', params: { id } });

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: color.paper }}>
      <SectionList
        sections={sections}
        keyExtractor={(r) => r.id}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={{ padding: space(5), paddingBottom: space(12) }}
        refreshControl={
          <RefreshControl
            refreshing={state.status === 'ready' && state.refreshing}
            onRefresh={refresh}
            tintColor={color.inkMuted}
          />
        }
        ListHeaderComponent={
          <View style={{ gap: space(6) }}>
            <View style={{ gap: space(2) }}>
              <View
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <Wordmark size={26} />
                <Text variant="small" tone="faint">
                  {mastheadDate()}
                </Text>
              </View>
              <Rule strong />
            </View>
            <View style={{ gap: space(1) }}>
              <Text variant="display">
                {greeting()}
                {firstName ? `, ${firstName}` : ''}.
              </Text>
              {state.status === 'ready' && (
                <Text tone="muted" style={{ fontSize: 17 }}>
                  {unread > 0
                    ? `${unread} unread ${unread === 1 ? 'briefing' : 'briefings'} waiting for you.`
                    : reports.length > 0
                      ? 'You’re all caught up.'
                      : 'Your first briefing is on its way.'}
                </Text>
              )}
            </View>
            {state.status === 'error' && (
              <Notice>We couldn’t load your briefings. Pull down to try again.</Notice>
            )}
            {state.status === 'ready' && (
              <>
                <SetupPrompt prefs={state.data.prefs} onPress={() => router.push('/preferences')} />
                {lead ? (
                  <LeadCard report={lead} onPress={() => open(lead.id)} />
                ) : (
                  <EmptyState prefs={state.data.prefs} />
                )}
              </>
            )}
            {rest.length > 0 && (
              <View style={{ gap: space(3), marginTop: space(4) }}>
                <Text variant="title">Archive</Text>
                <Rule strong />
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space(2) }}>
                  {FILTERS.map(({ id, label }) => (
                    <Chip
                      key={id}
                      label={label}
                      selected={filter === id}
                      onPress={() => setFilter(id)}
                    />
                  ))}
                </View>
              </View>
            )}
          </View>
        }
        renderSectionHeader={({ section }) => (
          <Text
            variant="eyebrow"
            tone="faint"
            style={{ marginTop: space(7), marginBottom: space(1) }}
          >
            {section.title}
          </Text>
        )}
        renderItem={({ item }) => <ArchiveRow report={item} onPress={() => open(item.id)} />}
        ItemSeparatorComponent={() => <Rule />}
        ListEmptyComponent={
          rest.length > 0 ? (
            <Text tone="faint" style={{ textAlign: 'center', marginTop: space(10) }}>
              Nothing here.
            </Text>
          ) : undefined
        }
      />
    </SafeAreaView>
  );
}

function LeadCard({ report, onPress }: { report: ReportWire; onPress: () => void }) {
  const { color } = useTheme();
  const unread = report.readAt === null;
  const categories = categoriesOf(report);
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        borderRadius: radius.lg + 8,
        borderWidth: 1,
        borderColor: color.rule,
        backgroundColor: color.surface,
        padding: space(6),
        gap: space(3),
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(2) }}>
        <Text variant="eyebrow" tone="accent">
          Latest · {frequencyLabel(report.frequency)}
        </Text>
        {unread && (
          <View
            style={{
              backgroundColor: color.accent,
              borderRadius: radius.pill,
              paddingHorizontal: space(2),
              paddingVertical: 2,
            }}
          >
            <Text variant="eyebrow" tone="onAccent" style={{ fontSize: 9, lineHeight: 12 }}>
              New
            </Text>
          </View>
        )}
      </View>
      <Text variant="title">{reportHeadline(categories)}</Text>
      <Text tone="muted">
        {periodLabel(report)} · {deliveredLabel(report.createdAt)}
      </Text>
      <View
        style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space(1.5), marginTop: space(1) }}
      >
        {categories.map((c) => (
          <View
            key={c}
            style={{
              backgroundColor: color.sunken,
              borderRadius: radius.pill,
              paddingHorizontal: space(3),
              paddingVertical: space(1),
            }}
          >
            <Text variant="small" tone="muted">
              {categoryLabel(c)}
            </Text>
          </View>
        ))}
      </View>
      <Text style={{ fontFamily: font.sansMedium, marginTop: space(3) }}>
        {unread ? 'Read briefing →' : 'Read again →'}
      </Text>
    </Pressable>
  );
}

function ArchiveRow({ report, onPress }: { report: ReportWire; onPress: () => void }) {
  const { color } = useTheme();
  const unread = report.readAt === null;
  const created = new Date(report.createdAt);
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: space(4),
        paddingVertical: space(4),
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <View style={{ width: 44, alignItems: 'center' }}>
        <Text variant="title" style={{ lineHeight: 30 }}>
          {created.getDate()}
        </Text>
        <Text variant="eyebrow" tone="faint" style={{ fontSize: 10 }}>
          {created.toLocaleDateString(undefined, { weekday: 'short' })}
        </Text>
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="eyebrow" tone="faint" style={{ fontSize: 10 }}>
          {frequencyLabel(report.frequency)}
        </Text>
        <Text
          variant="heading"
          tone={unread ? 'ink' : 'muted'}
          numberOfLines={1}
          style={{ fontFamily: unread ? font.serifSemibold : font.serif }}
        >
          {reportHeadline(categoriesOf(report))}
        </Text>
        <Text variant="small" tone="faint">
          {periodLabel(report)}
        </Text>
      </View>
      {unread && (
        <View
          accessibilityLabel="Unread"
          style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: color.accent }}
        />
      )}
    </Pressable>
  );
}

function SetupPrompt({ prefs, onPress }: { prefs: UserWithPreferencesWire; onPress: () => void }) {
  const { color } = useTheme();
  if (prefs.dailyCategories.length > 0 || prefs.weeklyCategories.length > 0) return null;
  return (
    <View
      style={{
        borderRadius: radius.lg,
        backgroundColor: color.accentSoft,
        padding: space(5),
        gap: space(2),
      }}
    >
      <Text variant="eyebrow" tone="accent">
        Set up
      </Text>
      <Text variant="heading">Choose what you want to follow.</Text>
      <Text tone="muted">
        Pick your beats and a delivery time, and your first briefing will arrive at that hour.
      </Text>
      <Button
        label="Choose beats"
        onPress={onPress}
        style={{ marginTop: space(2), alignSelf: 'flex-start' }}
      />
    </View>
  );
}

function EmptyState({ prefs }: { prefs: UserWithPreferencesWire }) {
  const { color } = useTheme();
  if (prefs.dailyCategories.length === 0 && prefs.weeklyCategories.length === 0) return null;
  return (
    <View
      style={{
        borderRadius: radius.lg,
        borderWidth: 1,
        borderStyle: 'dashed',
        borderColor: color.rule,
        padding: space(8),
        alignItems: 'center',
        gap: space(2),
      }}
    >
      <Text variant="heading">Nothing to read yet</Text>
      <Text tone="muted" style={{ textAlign: 'center' }}>
        Your first briefing arrives at {hourLabel(prefs.deliveryHour)} ({prefs.timezone}).
      </Text>
    </View>
  );
}
