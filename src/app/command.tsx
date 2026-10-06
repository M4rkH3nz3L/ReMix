import { Ionicons } from '@expo/vector-icons';
import { router, Stack } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { palette } from '@/constants/editor';
import { listProjects } from '@/lib/storage';
import { studioRoute } from '@/lib/projectUtils';
import { loadWorkspace } from '@/lib/workspaceClient';
import { workspaceSearchDocs } from '@/lib/workspace';
import {
  groupByScope,
  parseQuery,
  search,
  suggest,
  type SearchDoc,
  type SearchResult,
  type SearchScope,
} from '@/lib/universalSearch';

/**
 * ⌘K — Universal Search / Command Palette. A [universalSearch](@/lib/universalSearch)
 * mag ÉLŐ felülete: a helyi projektek + a workspace (asset/jegyzet/feladat/sablon)
 * fölött keres, természetes-nyelvi szűrőkkel („félbehagyott projektek", „tavalyi
 * nyári fotók"). A parancs-sáv alatt látszanak a KINYERT szűrők (scope/státusz/
 * idő/keresőszó) — így a NL-parser viselkedése azonnal megfigyelhető.
 */

const SCOPE_ICON: Record<SearchScope, keyof typeof Ionicons.glyphMap> = {
  project: 'cube',
  asset: 'folder',
  person: 'person',
  message: 'chatbubble-ellipses',
  music: 'musical-notes',
  photo: 'image',
  video: 'videocam',
  document: 'document-text',
  template: 'albums',
  shop: 'cart',
  ai: 'sparkles',
};

const SCOPE_LABEL: Record<SearchScope, string> = {
  project: 'Projektek',
  asset: 'Assetek',
  person: 'Emberek',
  message: 'Üzenetek',
  music: 'Zene',
  photo: 'Fotók',
  video: 'Videók',
  document: 'Dokumentumok',
  template: 'Sablonok',
  shop: 'Shop',
  ai: 'AI',
};

export default function CommandPaletteScreen() {
  const [query, setQuery] = useState('');
  const [docs, setDocs] = useState<SearchDoc[]>([]);
  const now = useMemo(() => new Date().toISOString(), []);

  // helyi projektek + (ha van) workspace-dokumentumok betöltése kereshető formába
  useEffect(() => {
    let alive = true;
    (async () => {
      const metas = await listProjects().catch(() => []);
      const projectDocs: SearchDoc[] = metas.map((m) => ({
        id: m.id,
        scope: 'project',
        title: m.name,
        subtitle: m.kind ?? 'video',
        keywords: [m.kind ?? 'video', m.aspectRatio],
        updatedAt: m.updatedAt,
        meta: { kind: m.kind ?? 'video', published: false },
      }));
      let wsDocs: SearchDoc[] = [];
      try {
        wsDocs = workspaceSearchDocs(await loadWorkspace());
      } catch {
        wsDocs = [];
      }
      if (alive) {
        setDocs([...projectDocs, ...wsDocs]);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const parsed = useMemo(() => parseQuery(query), [query]);
  const results = useMemo(() => search(docs, query, { now }), [docs, query, now]);
  const groups = useMemo(() => groupByScope(results), [results]);
  // „did-you-mean" / autocomplete: ha van keresőszó, de nincs (pontos) találat,
  // a `suggest` mag ad típushiba-toleráns javaslatokat (tappolva beírja).
  const suggestions = useMemo(
    () => (parsed.terms.length > 0 && results.length === 0 ? suggest(docs, query, { limit: 6 }) : []),
    [parsed.terms.length, results.length, docs, query]
  );

  const onSelect = (r: SearchResult) => {
    if (r.scope === 'project') {
      const kind = (r.meta?.kind as 'video' | 'image' | 'audio' | undefined) ?? 'video';
      router.push(studioRoute(kind, r.id) as never);
    }
  };

  // lapos, szekció-fejlécezett lista (FlatList-barát)
  type Row = { type: 'header'; scope: SearchScope } | { type: 'row'; result: SearchResult };
  const rows: Row[] = [];
  (Object.keys(groups) as SearchScope[]).forEach((scope) => {
    const list = groups[scope];
    if (!list || list.length === 0) {
      return;
    }
    rows.push({ type: 'header', scope });
    for (const result of list) {
      rows.push({ type: 'row', result });
    }
  });

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <Ionicons name="search" size={18} color={palette.textDim} />
        <TextInput
          style={styles.input}
          placeholder="Keress projektet, assetet, feladatot… (pl. „félbehagyott projektek”)"
          placeholderTextColor={palette.textDim}
          value={query}
          onChangeText={setQuery}
          autoFocus
          returnKeyType="search"
          testID="cmdk-input"
        />
        <Pressable onPress={() => router.back()} hitSlop={10} testID="cmdk-close">
          <Ionicons name="close" size={22} color={palette.textDim} />
        </Pressable>
      </View>

      {/* KINYERT szűrők — a NL-parser láthatóvá tétele */}
      {(parsed.scopes.length > 0 || parsed.status || parsed.timeHints.length > 0 || parsed.terms.length > 0) && (
        <View style={styles.chips} testID="cmdk-chips">
          {parsed.scopes.map((s) => (
            <Chip key={`s-${s}`} icon="funnel" label={SCOPE_LABEL[s]} tone="accent" />
          ))}
          {parsed.status && <Chip icon="flag" label={parsed.status === 'unfinished' ? 'félbehagyott' : 'kész'} tone="accent" />}
          {parsed.timeHints.map((t) => (
            <Chip key={`t-${t}`} icon="time" label={t} tone="accent" />
          ))}
          {parsed.terms.map((t) => (
            <Chip key={`q-${t}`} icon="text" label={t} tone="dim" />
          ))}
        </View>
      )}

      {/* did-you-mean / autocomplete javaslatok (tappolva beírja) */}
      {suggestions.length > 0 && (
        <View style={styles.chips} testID="cmdk-suggestions">
          <Text style={styles.suggestLabel}>Erre gondoltál?</Text>
          {suggestions.map((s) => (
            <Pressable
              key={`sug-${s}`}
              style={styles.suggestChip}
              onPress={() => setQuery(s)}
              testID={`cmdk-suggest-${s}`}
            >
              <Ionicons name="return-down-forward" size={12} color={palette.accent} />
              <Text style={styles.suggestText} numberOfLines={1}>
                {s}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      <FlatList
        data={rows}
        keyExtractor={(r, i) => (r.type === 'header' ? `h-${r.scope}` : `r-${r.result.scope}-${r.result.id}-${i}`)}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={<Text style={styles.empty}>Nincs találat.</Text>}
        renderItem={({ item }) =>
          item.type === 'header' ? (
            <Text style={styles.section}>{SCOPE_LABEL[item.scope]}</Text>
          ) : (
            <Pressable style={styles.row} onPress={() => onSelect(item.result)} testID={`cmdk-row-${item.result.id}`}>
              <View style={styles.rowIcon}>
                <Ionicons name={SCOPE_ICON[item.result.scope]} size={18} color={palette.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle} numberOfLines={1}>
                  {item.result.title}
                </Text>
                {!!item.result.subtitle && (
                  <Text style={styles.rowSub} numberOfLines={1}>
                    {item.result.subtitle}
                  </Text>
                )}
              </View>
              <Ionicons name="chevron-forward" size={16} color={palette.textDim} />
            </Pressable>
          )
        }
      />
    </SafeAreaView>
  );
}

function Chip({ icon, label, tone }: { icon: keyof typeof Ionicons.glyphMap; label: string; tone: 'accent' | 'dim' }) {
  return (
    <View style={[styles.chip, tone === 'accent' ? styles.chipAccent : styles.chipDim]}>
      <Ionicons name={icon} size={12} color={tone === 'accent' ? palette.accent : palette.textDim} />
      <Text style={[styles.chipText, { color: tone === 'accent' ? palette.text : palette.textDim }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: palette.border,
  },
  input: { flex: 1, color: palette.text, fontSize: 16, paddingVertical: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 16, paddingVertical: 10 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12 },
  chipAccent: { backgroundColor: palette.accentSoft },
  chipDim: { backgroundColor: palette.surfaceHigh },
  chipText: { fontSize: 12, fontWeight: '600' },
  suggestLabel: { color: palette.textDim, fontSize: 12, fontWeight: '700', alignSelf: 'center', marginRight: 2 },
  suggestChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: palette.accent,
    maxWidth: 180,
  },
  suggestText: { color: palette.accent, fontSize: 12, fontWeight: '600' },
  section: { color: palette.textDim, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  rowIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: palette.surface, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { color: palette.text, fontSize: 15, fontWeight: '600' },
  rowSub: { color: palette.textDim, fontSize: 12, marginTop: 2 },
  empty: { color: palette.textDim, textAlign: 'center', marginTop: 40 },
});
