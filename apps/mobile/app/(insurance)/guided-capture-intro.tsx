import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CaptureInstructions } from '@/features/guided-capture/components/capture-instructions';
import { DEFAULT_STOP_COUNT } from '@/features/guided-capture/constants';
import {
  hasSeenGuidedCaptureIntro,
  markGuidedCaptureIntroSeen,
} from '@/features/guided-capture/storage/guided-capture-intro-seen-store';
import { loadGuidedCaptureStoreState } from '@/features/guided-capture/storage/guided-capture-store';
import { HEIGHT_STEPS } from '@/features/guided-capture/types';

const ORANGE = '#f97316';
const TEXT = '#111111';

export default function GuidedCaptureIntroScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { requiredDone } = useLocalSearchParams<{ requiredDone?: string }>();
  const cameFromRequiredDone = requiredDone === '1';
  const [hasRequiredPhotos, setHasRequiredPhotos] = useState(false);
  // Checked once on mount, not on every focus — this screen should only ever
  // auto-skip on the way in from the task hub, not re-trigger if the user
  // navigates back to it from the capture screen itself. The "just finished
  // the required stops" redirect (from capture.tsx) always shows the intro
  // regardless of this flag — that's a distinct, always-shown checkpoint,
  // not the first-run walkthrough.
  const [showIntro, setShowIntro] = useState(cameFromRequiredDone);

  useEffect(() => {
    if (cameFromRequiredDone) return;
    let cancelled = false;
    void hasSeenGuidedCaptureIntro().then((seen) => {
      if (cancelled) return;
      if (seen) {
        router.replace('/(insurance)/capture');
      } else {
        setShowIntro(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [router, cameFromRequiredDone]);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void loadGuidedCaptureStoreState().then((state) => {
        if (cancelled) return;
        setHasRequiredPhotos(state.photos.length >= DEFAULT_STOP_COUNT * HEIGHT_STEPS.length);
      });
      return () => {
        cancelled = true;
      };
    }, [])
  );

  const onNextPress = () => {
    // Arrived here from capture.tsx after the required stops finished — go back to that
    // same still-mounted screen instance (preserving its live phase/state) rather than
    // pushing a fresh one, which would otherwise re-resume mid-flow from scratch.
    if (cameFromRequiredDone) {
      router.back();
      return;
    }
    void markGuidedCaptureIntroSeen();
    router.push('/(insurance)/capture');
  };

  if (!showIntro) {
    return <SafeAreaView style={styles.safe} edges={['top', 'left', 'right', 'bottom']} />;
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right', 'bottom']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          {navigation.canGoBack() ? (
            <Pressable
              onPress={() => router.back()}
              style={({ pressed }) => [styles.headerBack, pressed && styles.pressed]}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Go back">
              <View style={styles.headerChevronWrap} collapsable={false}>
                <Ionicons name="chevron-back" size={22} color={TEXT} />
              </View>
              <Text style={styles.headerTitle}>Guided capture camera angles</Text>
            </Pressable>
          ) : (
            <Text style={styles.headerTitle}>Guided Capture</Text>
          )}
        </View>

        {hasRequiredPhotos ? (
          <View style={styles.doneBanner}>
            <Ionicons name="checkmark-circle" size={20} color={ORANGE} style={styles.doneBannerIcon} />
            <Text style={styles.doneBannerText}>The required images are captured.</Text>
          </View>
        ) : null}

        <CaptureInstructions />

        <View style={styles.footer}>
          <Pressable
            style={({ pressed }) => [styles.nextBtn, pressed && styles.nextPressed]}
            onPress={onNextPress}
            accessibilityRole="button"
            accessibilityLabel="Continue to camera">
            <Text style={styles.nextBtnText}>Next</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
  },
  header: {
    marginBottom: 5,
    paddingTop: 45,
  },
  headerBack: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingBottom: 1,
    paddingRight: 8,
  },
  headerChevronWrap: {
    width: 28,
    height: 28,
    marginRight: 4,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: TEXT,
    flexShrink: 0,
  },
  pressed: {
    opacity: 0.65,
  },
  doneBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: '#FFEDD5',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 14,
  },
  doneBannerIcon: {
    marginTop: 1,
  },
  doneBannerText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    color: TEXT,
    fontWeight: '700',
  },
  footer: {
    // No horizontal padding here — this now sits inside scrollContent, which
    // already applies paddingHorizontal: 20. It used to be a sibling of the
    // ScrollView (pinned outside it), hence its own padding back then.
    marginTop: 20,
    paddingBottom: 20,
    backgroundColor: '#ffffff',
  },
  nextBtn: {
    backgroundColor: ORANGE,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nextPressed: {
    opacity: 0.92,
  },
  nextBtnText: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '700',
  },
});
