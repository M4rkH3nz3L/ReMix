import { router } from 'expo-router';
import { Component, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/editor';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Catch-all hibahatár: ha bármelyik képernyő render közben kivételt dob, az app
 * NEM omlik össze (fehér/piros képernyő) — helyette egy visszaállítható panel
 * jelenik meg. A hiba a konzolra kerül (Metro), a felhasználó pedig „Újra" vagy
 * „Kezdőképernyő" gombbal folytathatja. React error boundary → osztály-komponens.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string }) {
    // a Metro konzolra — így a fejlesztés közbeni hibák nyoma megmarad
    console.error('[ErrorBoundary]', error, info?.componentStack ?? '');
  }

  private reset = () => {
    this.setState({ error: null });
  };

  private goHome = () => {
    // előbb elnavigálunk a gyökérre, majd feloldjuk a hibát (a régi, hibás
    // képernyő így nem renderelődik újra azonnal ugyanazzal a hibával)
    try {
      router.replace('/');
    } catch {
      // ha a router még nem áll készen, a puszta reset is segít
    }
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    if (!error) {
      return this.props.children;
    }
    return (
      <View style={styles.container}>
        <Text style={styles.emoji}>😵‍💫</Text>
        <Text style={styles.title}>Hoppá, valami elakadt</Text>
        <Text style={styles.msg}>
          Az app nem állt le — próbáld újra, vagy lépj vissza a kezdőképernyőre.
        </Text>
        <ScrollView style={styles.detailBox} contentContainerStyle={styles.detailContent}>
          <Text style={styles.detail}>{error.message || String(error)}</Text>
        </ScrollView>
        <View style={styles.row}>
          <Pressable onPress={this.reset} style={[styles.btn, styles.btnPrimary]}>
            <Text style={styles.btnText}>Újra</Text>
          </Pressable>
          <Pressable onPress={this.goHome} style={styles.btn}>
            <Text style={styles.btnText}>Kezdőképernyő</Text>
          </Pressable>
        </View>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: palette.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
    gap: 12,
  },
  emoji: {
    fontSize: 44,
  },
  title: {
    color: palette.text,
    fontSize: 20,
    fontWeight: '800',
  },
  msg: {
    color: palette.textDim,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  detailBox: {
    maxHeight: 120,
    alignSelf: 'stretch',
    backgroundColor: palette.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: palette.border,
    marginTop: 4,
  },
  detailContent: {
    padding: 12,
  },
  detail: {
    color: palette.danger,
    fontSize: 12,
    fontFamily: 'Menlo',
  },
  row: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  btn: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: palette.surfaceHigh,
    borderWidth: 1,
    borderColor: palette.border,
  },
  btnPrimary: {
    backgroundColor: palette.accent,
    borderColor: palette.accent,
  },
  btnText: {
    color: palette.text,
    fontSize: 14,
    fontWeight: '700',
  },
});
