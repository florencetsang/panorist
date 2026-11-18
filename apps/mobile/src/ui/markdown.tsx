/** Native renderer for the model-written markdown AST from @panorist/core. */

import * as WebBrowser from 'expo-web-browser';
import { Fragment, useMemo } from 'react';
import { Text as RNText, View } from 'react-native';

import { parseMarkdown, type Block, type Inline, type List } from '@panorist/core/markdown';
import { Rule, Text } from './primitives.tsx';
import { font, radius, space, useTheme } from './theme.ts';

const isWebUrl = (href: string) => /^https?:\/\//i.test(href);

function Inlines({ nodes }: { nodes: Inline[] }) {
  const { color } = useTheme();
  return (
    <>
      {nodes.map((node, i) => {
        switch (node.type) {
          case 'text':
            return <Fragment key={i}>{node.text}</Fragment>;
          case 'strong':
            return (
              <RNText key={i} style={{ fontFamily: font.serifSemibold, color: color.ink }}>
                {node.text}
              </RNText>
            );
          case 'em':
            return (
              <RNText key={i} style={{ fontFamily: font.serifItalic }}>
                {node.text}
              </RNText>
            );
          case 'code':
            return (
              <RNText
                key={i}
                style={{ fontFamily: 'monospace', fontSize: 15, backgroundColor: color.sunken }}
              >
                {node.text}
              </RNText>
            );
          case 'link':
            return (
              <RNText
                key={i}
                accessibilityRole="link"
                onPress={
                  isWebUrl(node.href)
                    ? () => void WebBrowser.openBrowserAsync(node.href)
                    : undefined
                }
                style={{
                  color: color.ink,
                  textDecorationLine: 'underline',
                  textDecorationColor: color.accent,
                }}
              >
                <Inlines nodes={node.children} />
              </RNText>
            );
        }
      })}
    </>
  );
}

function ListView({ list, depth = 0 }: { list: List; depth?: number }) {
  const { color } = useTheme();
  return (
    <View style={{ gap: space(2), marginTop: depth ? space(2) : 0 }}>
      {list.items.map((item, i) => (
        <View key={i} style={{ flexDirection: 'row', gap: space(2.5) }}>
          <Text variant="body" style={{ color: color.accent, minWidth: list.ordered ? 22 : 10 }}>
            {list.ordered ? `${i + 1}.` : '•'}
          </Text>
          <View style={{ flex: 1 }}>
            <Text variant="body">
              <Inlines nodes={item.content} />
            </Text>
            {item.sublist && <ListView list={item.sublist} depth={depth + 1} />}
          </View>
        </View>
      ))}
    </View>
  );
}

function BlockView({ block }: { block: Block }) {
  const { color } = useTheme();
  switch (block.type) {
    case 'heading':
      return (
        <Text
          variant={block.level <= 2 ? 'heading' : 'ui'}
          style={[{ marginTop: space(3) }, block.level > 2 && { fontFamily: font.sansSemibold }]}
        >
          <Inlines nodes={block.content} />
        </Text>
      );
    case 'paragraph':
      return (
        <Text variant="body">
          <Inlines nodes={block.content} />
        </Text>
      );
    case 'list':
      return <ListView list={block} />;
    case 'code':
      return (
        <View style={{ backgroundColor: color.sunken, borderRadius: radius.md, padding: space(4) }}>
          <RNText style={{ fontFamily: 'monospace', fontSize: 14, color: color.ink }}>
            {block.text}
          </RNText>
        </View>
      );
    case 'rule':
      return <Rule style={{ alignSelf: 'center', width: 64, marginVertical: space(4) }} />;
  }
}

export function Markdown({ source }: { source: string }) {
  const blocks = useMemo(() => parseMarkdown(source), [source]);
  return (
    <View style={{ gap: space(5) }}>
      {blocks.map((block, i) => (
        <BlockView key={i} block={block} />
      ))}
    </View>
  );
}
