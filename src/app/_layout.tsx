import { DarkTheme, ThemeProvider, router } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import AppTabs from '@/components/app-tabs';
import {
  configureNotificationHandler,
  requestNotificationsPermission,
  scheduleChallenges,
} from '@/lib/notifications';
import { UserProvider, useUser } from '@/lib/user-context';

configureNotificationHandler();

function useNotificationDeepLink() {
  useEffect(() => {
    if (Platform.OS === 'web') return undefined;

    function redirect(notification: Notifications.Notification) {
      const url = notification.request.content.data?.url;
      if (typeof url === 'string') router.push(url as never);
    }

    const last = Notifications.getLastNotificationResponse();
    if (last?.notification) redirect(last.notification);

    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      redirect(response.notification);
    });

    return () => subscription.remove();
  }, []);
}

function ChallengeScheduler() {
  const { settings, points } = useUser();
  const pointsRef = useRef(points);
  pointsRef.current = points;

  useEffect(() => {
    let active = true;
    (async () => {
      const granted = await requestNotificationsPermission();
      if (active && granted) await scheduleChallenges(settings, pointsRef.current);
    })();
    return () => {
      active = false;
    };
  }, [settings]);

  return null;
}

export default function TabLayout() {
  useNotificationDeepLink();

  return (
    <ThemeProvider value={DarkTheme}>
      <UserProvider>
        <ChallengeScheduler />
        <AnimatedSplashOverlay />
        <AppTabs />
      </UserProvider>
    </ThemeProvider>
  );
}
