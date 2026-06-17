import { ReactNode } from 'react';
import {
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Brand } from '@/constants/brand';
import { Fonts } from '@/constants/theme';

export function Screen({ children }: { children: ReactNode }) {
  return (
    <View style={styles.screen}>
      <View style={styles.topAccent} />
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}>
          {children}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

export function Kicker({ children }: { children: ReactNode }) {
  return <Text style={styles.kicker}>{children}</Text>;
}

export function Title({ children }: { children: ReactNode }) {
  return <Text style={styles.title}>{children}</Text>;
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <Text style={styles.sectionLabel}>{children}</Text>;
}

export function Card({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function StatCard({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.statCard}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: Brand.bg,
  },
  topAccent: {
    height: 3,
    backgroundColor: Brand.accent,
  },
  safe: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: Platform.select({ web: 84, default: 12 }),
    paddingBottom: 120,
    gap: 18,
  },
  kicker: {
    fontFamily: Fonts.mono,
    fontSize: 12,
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: Brand.accent,
    fontWeight: '700',
  },
  title: {
    fontFamily: Fonts.mono,
    fontSize: 30,
    lineHeight: 34,
    letterSpacing: -0.5,
    color: Brand.text,
    fontWeight: '700',
  },
  sectionLabel: {
    fontFamily: Fonts.mono,
    fontSize: 12,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: Brand.textSecondary,
    fontWeight: '700',
  },
  card: {
    backgroundColor: Brand.surface,
    borderRadius: Brand.radiusLg,
    borderWidth: 1,
    borderColor: Brand.border,
    padding: 18,
  },
  statCard: {
    flex: 1,
    backgroundColor: Brand.surface,
    borderRadius: Brand.radiusLg,
    borderWidth: 1,
    borderColor: Brand.border,
    paddingVertical: 16,
    paddingHorizontal: 14,
    gap: 4,
  },
  statValue: {
    fontFamily: Fonts.mono,
    fontSize: 24,
    color: Brand.text,
    fontWeight: '700',
  },
  statLabel: {
    fontSize: 11,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: Brand.textTertiary,
  },
});
