/** The reader's saved AI explanations, newest first, with an All / Starred filter. */

import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ApiError } from '@panorist/core/api';
import { INSIGHT_KIND_LABEL, INSIGHT_PAGE_SIZE } from '@panorist/core/insights';
import type { InsightWire } from '@panorist/core/types';
import { useSession } from '../auth/session.tsx';
import { useFocusLoad } from '../lib/use-load.ts';
import { Button, Chip, Loading, Notice, Rule, Text } from '../ui/primitives.tsx';
import { space, useTheme } from '../ui/theme.ts';
import { InsightContent } from './insight-sheet.tsx';

type Filter = 'all' | 'starred';

export function LibraryScreen() {
  const { api } = useSession();
  const { color } = useTheme();
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>('all');
  const [open, setOpen] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  const { state, setState, refresh } = useFocusLoad(async () => {
    try {
      const items = await api.listInsights({ starred: filter === 'starred' });
      setUnavailable(false);
      return { items, more: items.length === INSIGHT_PAGE_SIZE, filter };
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setUnavailable(true);
      throw err;
    }
  });

  // Focus loads cover returning to the tab; a filter change reloads too.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) firstRender.current = false;
    else void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh is recreated each render
  }, [filter]);
  const data = state.status === 'ready' && state.data.filter === filter ? state.data : null;

  function update(items: InsightWire[], more = data?.more ?? false) {
    setState({ status: 'ready', data: { items, more, filter }, refreshing: false });
  }

  async function loadMore() {
    if (!data || !data.more) return;
    setLoadingMore(true);
    try {
      const page = await api.listInsights({
        starred: filter === 'starred',
        before: data.items.at(-1)?.id ?? undefined,
      });
      update([...data.items, ...page], page.length === INSIGHT_PAGE_SIZE);
    } catch (err) {
      console.warn('[library] load more failed', err);
    } finally {
      setLoadingMore(false);
    }
  }

  async function remove(id: string) {
    if (!data) return;
    try {
      await api.deleteInsight(id);
      update(data.items.filter((item) => item.id !== id));
    } catch (err) {
      console.warn('[library] delete failed', err);
    }
  }

  function replace(insight: InsightWire) {
    if (!data) return;
    update(
      data.items
        .map((item) => (item.id === insight.id ? insight : item))
        .filter((item) => filter === 'all' || item.starredAt !== null),
    );
  }

  if (state.status === 'loading') return <Loading />;

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: color.paper }}>
      <FlatList
        data={data?.items ?? []}
        keyExtractor={(item) => item.id ?? item.key}
        contentContainerStyle={{ padding: space(5), paddingBottom: space(12) }}
        refreshControl={
          <RefreshControl
            refreshing={state.status === 'ready' && state.refreshing}
            onRefresh={refresh}
            tintColor={color.inkMuted}
          />
        }
        ItemSeparatorComponent={Rule}
        ListHeaderComponent={
          <View style={{ gap: space(4), marginBottom: space(4) }}>
            <Text variant="eyebrow" tone="accent">
              Your library
            </Text>
            <Text variant="display">Saved explanations</Text>
            <Text tone="muted">
              Everything you’ve asked about. Star the ones you want to keep handy.
            </Text>
            <View style={{ flexDirection: 'row', gap: space(2) }}>
              <Chip label="All" selected={filter === 'all'} onPress={() => setFilter('all')} />
              <Chip
                label="Starred"
                selected={filter === 'starred'}
                onPress={() => setFilter('starred')}
              />
            </View>
            {unavailable ? (
              <Notice>The library isn’t available on your plan.</Notice>
            ) : (
              state.status === 'error' && (
                <Notice>We couldn’t load your library. Pull down to try again.</Notice>
              )
            )}
            <Rule strong />
          </View>
        }
        ListEmptyComponent={
          data ? (
            <Text tone="muted" style={{ textAlign: 'center', marginTop: space(8) }}>
              {filter === 'starred'
                ? 'No starred explanations yet.'
                : 'Nothing saved yet. Tap a highlighted event or term in a briefing to get started.'}
            </Text>
          ) : undefined
        }
        renderItem={({ item }) => {
          const id = item.id ?? '';
          const expanded = open === id;
          return (
            <View style={{ paddingVertical: space(4), gap: space(4) }}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded }}
                onPress={() => setOpen(expanded ? null : id)}
                style={{ gap: space(1) }}
              >
                <Text variant="eyebrow" tone="faint">
                  {INSIGHT_KIND_LABEL[item.kind]}
                  {item.starredAt ? '  ★' : ''}
                </Text>
                <Text variant="heading">{item.displayName}</Text>
              </Pressable>
              {expanded && (
                <>
                  <InsightContent insight={item} onChange={replace} />
                  <View style={{ flexDirection: 'row', gap: space(3), flexWrap: 'wrap' }}>
                    {item.reportId && (
                      <Button
                        variant="secondary"
                        label="Open the briefing"
                        onPress={() =>
                          router.push({
                            pathname: '/reports/[id]',
                            params: { id: item.reportId ?? '' },
                          })
                        }
                      />
                    )}
                    <Button variant="ghost" label="Remove" onPress={() => remove(id)} />
                  </View>
                </>
              )}
            </View>
          );
        }}
        ListFooterComponent={
          data?.more ? (
            <Button
              variant="secondary"
              label="Load more"
              busy={loadingMore}
              onPress={loadMore}
              style={{ marginTop: space(6) }}
            />
          ) : undefined
        }
      />
    </SafeAreaView>
  );
}
