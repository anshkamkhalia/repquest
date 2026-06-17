import { useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import { Card, Kicker, Screen, SectionLabel, StatCard, Title } from '@/components/ui/brand-ui';
import { Brand } from '@/constants/brand';
import { Fonts } from '@/constants/theme';
import {
  DIFFICULTY_LABEL,
  DIFFICULTY_PREFS,
  type DifficultyPref,
} from '@/constants/workout-rules';
import { buildLeaderboard, getInitials } from '@/lib/leaderboard';
import { sendTestChallenge } from '@/lib/notifications';
import { useUser } from '@/lib/user-context';

const EXERCISE_BREAKDOWN = [
  { label: 'Push-ups', value: 9 },
  { label: 'Squats', value: 7 },
  { label: 'Lunges', value: 6 },
];

function formatHour(hour: number): string {
  const h = ((hour % 24) + 24) % 24;
  const period = h < 12 ? 'AM' : 'PM';
  const display = h % 12 === 0 ? 12 : h % 12;
  return `${display} ${period}`;
}

function Stepper({ value, onChange }: { value: string; onChange: (delta: number) => void }) {
  return (
    <View style={styles.stepper}>
      <Pressable style={styles.stepperBtn} onPress={() => onChange(-1)}>
        <Text style={styles.stepperBtnText}>−</Text>
      </Pressable>
      <Text style={styles.stepperValue}>{value}</Text>
      <Pressable style={styles.stepperBtn} onPress={() => onChange(1)}>
        <Text style={styles.stepperBtnText}>+</Text>
      </Pressable>
    </View>
  );
}

export default function ProfileScreen() {
  const user = useUser();
  const { settings, updateSettings } = user;
  const board = buildLeaderboard(user);
  const rank = board.findIndex((u) => u.id === 'me') + 1;
  const [testNote, setTestNote] = useState<string | null>(null);

  const totalBreakdown = EXERCISE_BREAKDOWN.reduce((s, e) => s + e.value, 0);

  const onTest = async () => {
    const sent = await sendTestChallenge(settings, user.points);
    setTestNote(sent ? 'Quest scheduled — arriving in a few seconds.' : 'Test quests only work on a phone.');
  };

  return (
    <Screen>
      <View>
        <Kicker>Your profile</Kicker>
        <Title>{user.username}</Title>
      </View>

      <Card style={styles.identity}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{getInitials(user.username)}</Text>
        </View>
        <View style={styles.identityText}>
          <Text style={styles.name}>{user.username}</Text>
          <Text style={styles.handle}>Rank #{rank} worldwide</Text>
        </View>
      </Card>

      <View style={styles.statRow}>
        <StatCard value={user.points.toLocaleString()} label="Points" />
        <StatCard value={`${user.streak}d`} label="Streak" />
        <StatCard value={`${user.quests}`} label="Quests" />
      </View>

      <Card>
        <SectionLabel>Challenge settings</SectionLabel>
        <Text style={styles.cardIntro}>Control when and how quests are sent to you.</Text>

        <View style={styles.settingRow}>
          <View style={styles.settingText}>
            <Text style={styles.settingTitle}>Quest notifications</Text>
            <Text style={styles.settingSub}>Random challenges through the day</Text>
          </View>
          <Switch
            value={settings.notificationsEnabled}
            onValueChange={(v) => updateSettings({ notificationsEnabled: v })}
            trackColor={{ true: Brand.accent, false: Brand.border }}
            thumbColor="#fff"
          />
        </View>

        <View style={styles.divider} />

        <Text style={styles.fieldLabel}>Difficulty</Text>
        <View style={styles.prefRow}>
          {DIFFICULTY_PREFS.map((pref: DifficultyPref) => {
            const active = settings.difficulty === pref;
            return (
              <Pressable
                key={pref}
                onPress={() => updateSettings({ difficulty: pref })}
                style={[styles.prefChip, active && styles.prefChipActive]}>
                <Text style={[styles.prefChipText, active && styles.prefChipTextActive]}>
                  {DIFFICULTY_LABEL[pref]}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={styles.hint}>Auto scales the difficulty up as you bank more points.</Text>

        <View style={styles.divider} />

        <View style={styles.settingRow}>
          <View style={styles.settingText}>
            <Text style={styles.settingTitle}>Frequency</Text>
            <Text style={styles.settingSub}>Challenges per day</Text>
          </View>
          <Stepper
            value={`${settings.frequency}`}
            onChange={(d) =>
              updateSettings({ frequency: Math.min(8, Math.max(1, settings.frequency + d)) })
            }
          />
        </View>

        <View style={styles.divider} />

        <View style={styles.settingRow}>
          <View style={styles.settingText}>
            <Text style={styles.settingTitle}>Downtime</Text>
            <Text style={styles.settingSub}>No notifications in this window</Text>
          </View>
        </View>
        <View style={styles.downtimeRow}>
          <View style={styles.downtimeField}>
            <Text style={styles.downtimeLabel}>From</Text>
            <Stepper
              value={formatHour(settings.downtimeStart)}
              onChange={(d) => updateSettings({ downtimeStart: ((settings.downtimeStart + d + 24) % 24) })}
            />
          </View>
          <View style={styles.downtimeField}>
            <Text style={styles.downtimeLabel}>To</Text>
            <Stepper
              value={formatHour(settings.downtimeEnd)}
              onChange={(d) => updateSettings({ downtimeEnd: ((settings.downtimeEnd + d + 24) % 24) })}
            />
          </View>
        </View>

        <View style={styles.divider} />

        <Pressable style={styles.testBtn} onPress={onTest}>
          <Text style={styles.testBtnText}>Send a test quest</Text>
        </Pressable>
        {testNote ? <Text style={styles.hint}>{testNote}</Text> : null}
      </Card>

      <Card>
        <SectionLabel>Quest breakdown</SectionLabel>
        <View style={styles.breakdown}>
          {EXERCISE_BREAKDOWN.map((e) => (
            <View key={e.label} style={styles.breakRow}>
              <Text style={styles.breakLabel}>{e.label}</Text>
              <View style={styles.breakTrack}>
                <View style={[styles.breakFill, { width: `${(e.value / totalBreakdown) * 100}%` }]} />
              </View>
              <Text style={styles.breakValue}>{e.value}</Text>
            </View>
          ))}
        </View>
      </Card>

      <Pressable style={styles.signOut}>
        <Text style={styles.signOutText}>Sign out</Text>
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  identity: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  avatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: Brand.accentMuted,
    borderWidth: 1,
    borderColor: Brand.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: Brand.text, fontSize: 22, fontWeight: '700' },
  identityText: { gap: 4 },
  name: { color: Brand.text, fontSize: 20, fontWeight: '700' },
  handle: { color: Brand.textSecondary, fontSize: 13 },

  statRow: { flexDirection: 'row', gap: 10 },

  cardIntro: { color: Brand.textSecondary, fontSize: 13, marginTop: 8 },
  settingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 },
  settingText: { gap: 3, flex: 1 },
  settingTitle: { color: Brand.text, fontSize: 15, fontWeight: '600' },
  settingSub: { color: Brand.textTertiary, fontSize: 12 },
  divider: { height: 1, backgroundColor: Brand.border, marginVertical: 14 },

  fieldLabel: {
    color: Brand.textTertiary,
    fontSize: 11,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  prefRow: { flexDirection: 'row', gap: 8 },
  prefChip: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: Brand.radius,
    backgroundColor: Brand.bgElevated,
    borderWidth: 1,
    borderColor: Brand.border,
    alignItems: 'center',
  },
  prefChipActive: { backgroundColor: Brand.accentMuted, borderColor: Brand.accent },
  prefChipText: { color: Brand.textSecondary, fontSize: 13, fontWeight: '700' },
  prefChipTextActive: { color: Brand.text },
  hint: { color: Brand.textTertiary, fontSize: 12, marginTop: 8 },

  downtimeRow: { flexDirection: 'row', gap: 12, marginTop: 4 },
  downtimeField: { flex: 1, gap: 6 },
  downtimeLabel: { color: Brand.textTertiary, fontSize: 12 },

  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Brand.bgElevated,
    borderRadius: Brand.radius,
    borderWidth: 1,
    borderColor: Brand.border,
    padding: 3,
  },
  stepperBtn: {
    width: 34,
    height: 34,
    borderRadius: Brand.radius - 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Brand.surface,
  },
  stepperBtnText: { color: Brand.text, fontSize: 18, fontWeight: '700' },
  stepperValue: {
    minWidth: 64,
    textAlign: 'center',
    color: Brand.text,
    fontSize: 14,
    fontWeight: '700',
    fontFamily: Fonts.mono,
  },

  testBtn: {
    paddingVertical: 12,
    borderRadius: Brand.radius,
    borderWidth: 1,
    borderColor: Brand.borderStrong,
    alignItems: 'center',
  },
  testBtnText: { color: Brand.text, fontSize: 14, fontWeight: '700' },

  breakdown: { marginTop: 14, gap: 12 },
  breakRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  breakLabel: { color: Brand.textSecondary, fontSize: 13, width: 72 },
  breakTrack: {
    flex: 1,
    height: 8,
    borderRadius: 4,
    backgroundColor: Brand.bgElevated,
    overflow: 'hidden',
  },
  breakFill: { height: '100%', borderRadius: 4, backgroundColor: Brand.accent },
  breakValue: { fontFamily: Fonts.mono, color: Brand.text, fontSize: 13, width: 24, textAlign: 'right' },

  signOut: { alignItems: 'center', paddingVertical: 8 },
  signOutText: { color: Brand.accent, fontSize: 14, fontWeight: '700' },
});
