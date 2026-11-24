/**
 * Bottom-sheet modal for AI insights on the reader.
 *
 * - `target`: a highlight (or resolved selection) — shows its kind's action
 *   ("All I need to know" / "Tell me more"), then the explanation and a star.
 * - `pick`: free-select. React Native can't add actions to the native text
 *   selection menu, so a long-pressed paragraph opens here as tappable words;
 *   the reader taps the first and last word of a phrase, then "Explain".
 */

import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, Text as RNText, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ApiError } from '@panorist/core/api';
import {
  INSIGHT_ACTION_LABEL,
  INSIGHT_KIND_LABEL,
  SELECTION_LIMITS,
  insightErrorMessage,
  selectionProblem,
} from '@panorist/core/insights';
import type { InsightTarget, InsightWire } from '@panorist/core/types';
import { useSession } from '../auth/session.tsx';
import { Markdown } from '../ui/markdown.tsx';
import { Button, Notice, Rule, Text } from '../ui/primitives.tsx';
import { font, radius, space, useTheme } from '../ui/theme.ts';

export type SheetRequest =
  { type: 'target'; target: InsightTarget; sourceText?: string } | { type: 'pick'; text: string };

export function InsightSheet({
  request,
  reportId,
  onClose,
}: {
  request: SheetRequest | null;
  reportId?: string;
  onClose: () => void;
}) {
  const { color } = useTheme();
  const [current, setCurrent] = useState<SheetRequest | null>(request);
  useEffect(() => setCurrent(request), [request]);

  return (
    <Modal
      visible={current !== null}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView edges={['bottom']} style={{ flex: 1, backgroundColor: color.paper }}>
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'flex-end',
            paddingHorizontal: space(5),
            paddingTop: space(4),
          }}
        >
          <Pressable accessibilityRole="button" onPress={onClose} hitSlop={12}>
            <Text tone="muted" style={{ fontFamily: font.sansMedium }}>
              Done
            </Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: space(5), paddingTop: space(2) }}>
          {current?.type === 'pick' && reportId && (
            <WordPicker
              key={current.text}
              text={current.text}
              reportId={reportId}
              onResolved={(target) =>
                setCurrent({ type: 'target', target, sourceText: current.text })
              }
            />
          )}
          {current?.type === 'target' && (
            <TargetView
              key={`${current.target.kind}:${current.target.key}`}
              target={current.target}
              sourceText={current.sourceText}
              reportId={reportId}
            />
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

type ExplainState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; insight: InsightWire }
  | { status: 'error'; message: string };

function TargetView({
  target,
  sourceText,
  reportId,
}: {
  target: InsightTarget;
  sourceText?: string;
  reportId?: string;
}) {
  const { api } = useSession();
  const [state, setState] = useState<ExplainState>({ status: 'idle' });

  async function explain() {
    setState({ status: 'loading' });
    try {
      const insight = await api.explain({
        kind: target.kind,
        key: target.key,
        displayName: target.displayName,
        ...(reportId && { reportId }),
        ...(sourceText && { sourceText: sourceText.slice(0, 200) }),
      });
      setState({ status: 'ready', insight });
    } catch (err) {
      console.warn('[insight] explain failed', err);
      setState({
        status: 'error',
        message: insightErrorMessage(err instanceof ApiError ? err.status : null),
      });
    }
  }

  return (
    <View style={{ gap: space(5) }}>
      <View style={{ gap: space(2) }}>
        <Text variant="eyebrow" tone="accent">
          {INSIGHT_KIND_LABEL[target.kind]}
        </Text>
        <Text variant="title">{target.displayName}</Text>
      </View>
      <Rule />
      {state.status === 'idle' && (
        <Button label={INSIGHT_ACTION_LABEL[target.kind]} onPress={explain} />
      )}
      {state.status === 'loading' && (
        <Button
          label={
            target.kind === 'event' ? 'Catching you up on the latest…' : 'Writing an explainer…'
          }
          onPress={undefined}
          busy
          variant="secondary"
        />
      )}
      {state.status === 'error' && (
        <>
          <Notice>{state.message}</Notice>
          <Button label="Try again" variant="secondary" onPress={explain} />
        </>
      )}
      {state.status === 'ready' && (
        <InsightContent
          insight={state.insight}
          onChange={(insight) => setState({ status: 'ready', insight })}
        />
      )}
    </View>
  );
}

/** Explanation text with its star toggle; shared by the sheet and the library. */
export function InsightContent({
  insight,
  onChange,
}: {
  insight: InsightWire;
  onChange: (insight: InsightWire) => void;
}) {
  const { api } = useSession();
  const { color } = useTheme();
  const [busy, setBusy] = useState(false);
  const starred = insight.starredAt !== null;

  async function toggleStar() {
    if (insight.id === null) return;
    setBusy(true);
    try {
      onChange(await api.setInsightStarred(insight.id, !starred));
    } catch (err) {
      console.warn('[insight] star failed', err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ gap: space(5) }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text variant="small" tone="muted">
          Generated{' '}
          {new Date(insight.generatedAt).toLocaleDateString(undefined, {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          })}
        </Text>
        {insight.id !== null && (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: starred, disabled: busy }}
            onPress={toggleStar}
            disabled={busy}
            hitSlop={8}
            style={{
              borderRadius: radius.pill,
              borderWidth: 1,
              borderColor: starred ? color.accent : color.rule,
              backgroundColor: starred ? color.accentSoft : 'transparent',
              paddingHorizontal: space(3),
              paddingVertical: space(1.5),
              opacity: busy ? 0.5 : 1,
            }}
          >
            <RNText
              style={{
                fontFamily: font.sansMedium,
                fontSize: 14,
                color: starred ? color.ink : color.inkMuted,
              }}
            >
              {starred ? '★ Starred' : '☆ Star'}
            </RNText>
          </Pressable>
        )}
      </View>
      <Markdown source={insight.markdown} />
      {insight.id !== null && (
        <Text variant="small" tone="faint">
          Saved to your library.
        </Text>
      )}
    </View>
  );
}

function WordPicker({
  text,
  reportId,
  onResolved,
}: {
  text: string;
  reportId: string;
  onResolved: (target: InsightTarget) => void;
}) {
  const { api } = useSession();
  const { color } = useTheme();
  const words = useMemo(() => text.split(/\s+/).filter(Boolean), [text]);
  const [range, setRange] = useState<[number, number] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // First tap starts a phrase; the next tap extends it (or restarts if too long).
  function tap(i: number) {
    setError(null);
    if (!range || range[0] !== range[1]) return setRange([i, i]);
    const [start, end] = [Math.min(range[0], i), Math.max(range[0], i)];
    setRange(end - start < SELECTION_LIMITS.maxWords ? [start, end] : [i, i]);
  }

  const phrase = range ? words.slice(range[0], range[1] + 1).join(' ') : '';
  const problem = phrase ? selectionProblem(phrase) : null;

  async function resolve() {
    setBusy(true);
    setError(null);
    try {
      onResolved(await api.resolveSelection(phrase, reportId));
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 422)) {
        console.warn('[selection] resolve failed', err);
      }
      setError(insightErrorMessage(err instanceof ApiError ? err.status : null));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ gap: space(5) }}>
      <View style={{ gap: space(2) }}>
        <Text variant="eyebrow" tone="accent">
          Explain a phrase
        </Text>
        <Text tone="muted">
          Tap the first and last word of a name, event or term (up to {SELECTION_LIMITS.maxWords}{' '}
          words).
        </Text>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: space(1.5) }}>
        {words.map((word, i) => {
          const selected = range !== null && i >= range[0] && i <= range[1];
          return (
            <Pressable
              key={i}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => tap(i)}
              style={{
                paddingHorizontal: space(1),
                paddingVertical: space(0.5),
                borderRadius: radius.sm,
                backgroundColor: selected ? color.ink : 'transparent',
              }}
            >
              <RNText
                style={{
                  fontFamily: font.serif,
                  fontSize: 18,
                  lineHeight: 28,
                  color: selected ? color.paper : color.ink,
                }}
              >
                {word}
              </RNText>
            </Pressable>
          );
        })}
      </View>
      {error && <Notice>{error}</Notice>}
      <Button
        label={phrase ? `Explain “${phrase}”` : 'Select words to explain'}
        onPress={resolve}
        busy={busy}
        disabled={!phrase || problem !== null}
      />
    </View>
  );
}
