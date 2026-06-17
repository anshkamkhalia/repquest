import { StyleSheet, Text, View } from 'react-native';

import { Card, Kicker, Screen, SectionLabel, Title } from '@/components/ui/brand-ui';
import { Brand } from '@/constants/brand';
import { Fonts } from '@/constants/theme';
import { buildLeaderboard, getInitials, getRankTier, type RankTier } from '@/lib/leaderboard';
import { useUser } from '@/lib/user-context';

const TIER_COLOR: Record<RankTier['tone'], string> = {
  gold: Brand.gold,
  silver: Brand.silver,
  bronze: Brand.bronze,
  neutral: Brand.textTertiary,
};

export default function LeaderboardScreen() {
  const user = useUser();
  const board = buildLeaderboard(user);
  const total = board.length;
  const topPoints = board[0]?.points ?? 0;
  const podium = [board[1], board[0], board[2]].filter(Boolean);
  const podiumMeta = [
    { place: '2', height: 96 },
    { place: '1', height: 120 },
    { place: '3', height: 80 },
  ];

  return (
    <Screen>
      <View>
        <Kicker>Global rankings</Kicker>
        <Title>Leaderboard</Title>
      </View>

      <View style={styles.statRow}>
        <View style={styles.miniStat}>
          <Text style={styles.miniValue}>{total}</Text>
          <Text style={styles.miniLabel}>Athletes</Text>
        </View>
        <View style={styles.miniStat}>
          <Text style={styles.miniValue}>{topPoints.toLocaleString()}</Text>
          <Text style={styles.miniLabel}>Top score</Text>
        </View>
      </View>

      <View style={styles.podium}>
        {podium.map((u, i) => (
          <View key={u.id} style={styles.podiumSlot}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{getInitials(u.username)}</Text>
            </View>
            <Text style={styles.podiumName} numberOfLines={1}>
              {u.username}
            </Text>
            <Text style={styles.podiumPts}>{u.points.toLocaleString()}</Text>
            <View style={[styles.podiumBar, { height: podiumMeta[i].height }]}>
              <Text style={styles.podiumPlace}>{podiumMeta[i].place}</Text>
            </View>
          </View>
        ))}
      </View>

      <Card style={styles.boardCard}>
        <SectionLabel>Standings</SectionLabel>
        <View style={styles.rows}>
          {board.map((u, i) => {
            const rank = i + 1;
            const tier = getRankTier(rank, total);
            const isMe = u.id === 'me';
            return (
              <View key={u.id} style={[styles.row, isMe && styles.rowMe]}>
                <Text style={[styles.rank, rank <= 3 && styles.rankTop]}>#{rank}</Text>
                <View style={styles.rowAvatar}>
                  <Text style={styles.rowAvatarText}>{getInitials(u.username)}</Text>
                </View>
                <Text style={styles.rowName} numberOfLines={1}>
                  {u.username}
                  {isMe ? ' (you)' : ''}
                </Text>
                <Text style={styles.rowPts}>{u.points.toLocaleString()}</Text>
                <Text style={[styles.rowTier, { color: TIER_COLOR[tier.tone] }]}>{tier.label}</Text>
              </View>
            );
          })}
        </View>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  statRow: { flexDirection: 'row', gap: 10 },
  miniStat: {
    flex: 1,
    backgroundColor: Brand.surface,
    borderRadius: Brand.radiusLg,
    borderWidth: 1,
    borderColor: Brand.border,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  miniValue: { fontFamily: Fonts.mono, fontSize: 22, color: Brand.text, fontWeight: '700' },
  miniLabel: {
    fontSize: 11,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: Brand.textTertiary,
    marginTop: 2,
  },

  podium: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, justifyContent: 'center' },
  podiumSlot: { flex: 1, alignItems: 'center', gap: 6 },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Brand.accentMuted,
    borderWidth: 1,
    borderColor: Brand.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: Brand.text, fontWeight: '700', fontSize: 16 },
  podiumName: { color: Brand.text, fontSize: 13, fontWeight: '600', maxWidth: '100%' },
  podiumPts: { fontFamily: Fonts.mono, color: Brand.accent, fontSize: 13, fontWeight: '700' },
  podiumBar: {
    width: '100%',
    backgroundColor: Brand.surface,
    borderTopLeftRadius: Brand.radius,
    borderTopRightRadius: Brand.radius,
    borderWidth: 1,
    borderColor: Brand.border,
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: 10,
  },
  podiumPlace: { fontFamily: Fonts.mono, color: Brand.textSecondary, fontSize: 18, fontWeight: '700' },

  boardCard: { padding: 14 },
  rows: { marginTop: 12, gap: 2 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: Brand.radius,
  },
  rowMe: { backgroundColor: Brand.accentMuted },
  rank: { fontFamily: Fonts.mono, color: Brand.textSecondary, fontSize: 13, width: 34, fontWeight: '700' },
  rankTop: { color: Brand.accent },
  rowAvatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: Brand.bgElevated,
    borderWidth: 1,
    borderColor: Brand.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowAvatarText: { color: Brand.textSecondary, fontSize: 11, fontWeight: '700' },
  rowName: { flex: 1, color: Brand.text, fontSize: 14, fontWeight: '600' },
  rowPts: { fontFamily: Fonts.mono, color: Brand.text, fontSize: 14, fontWeight: '700' },
  rowTier: { fontSize: 12, fontWeight: '700', width: 76, textAlign: 'right' },
});
