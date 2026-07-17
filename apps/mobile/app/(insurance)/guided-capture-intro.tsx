import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DEFAULT_STOP_COUNT } from '@/features/guided-capture/constants';
import { loadGuidedCaptureStoreState } from '@/features/guided-capture/storage/guided-capture-store';
import { HEIGHT_STEPS } from '@/features/guided-capture/types';

const INTRO_DIAGRAM = require('../../assets/images/guided-capture-angles-intro.png');

const ORANGE = '#f97316';
const BG = '#f5f5f5';
const TEXT = '#111111';

export default function GuidedCaptureIntroScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const [hasRequiredPhotos, setHasRequiredPhotos] = useState(false);

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
              <Text style={styles.headerTitle}>Guided Capture</Text>
            </Pressable>
          ) : (
            <Text style={styles.headerTitle}>Guided Capture</Text>
          )}
        </View>

        <Text style={styles.pageTitle}>Guided capture camera angles</Text>

        <View style={styles.imageCard}>
          <Image source={INTRO_DIAGRAM} style={styles.diagram} resizeMode="contain" accessibilityIgnoresInvertColors />
        </View>

        <Text style={styles.body}>
        Walk around the vehicle to each stop. At every stop, take 3 photos: overhead (tilted down over the car), chest height, and waist height.
        </Text>

        {hasRequiredPhotos ? (
          <Text style={styles.doneNotice}>You already have the required photos.</Text>
        ) : null}
      </ScrollView>

      <View style={styles.footer}>
        {hasRequiredPhotos ? (
          <View style={styles.footerRow}>
            <Pressable
              style={({ pressed }) => [styles.backBtn, pressed && styles.backPressed]}
              onPress={() => router.back()}
              accessibilityRole="button"
              accessibilityLabel="Go back">
              <Text style={styles.backBtnText}>Back</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.nextBtn, styles.nextBtnFlex, pressed && styles.nextPressed]}
              onPress={() => router.push('/(insurance)/capture')}
              accessibilityRole="button"
              accessibilityLabel="Continue to camera">
              <Text style={styles.nextBtnText}>Next</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable
            style={({ pressed }) => [styles.nextBtn, pressed && styles.nextPressed]}
            onPress={() => router.push('/(insurance)/capture')}
            accessibilityRole="button"
            accessibilityLabel="Continue to camera">
            <Text style={styles.nextBtnText}>Next</Text>
          </Pressable>
        )}
      </View>
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
    paddingBottom: 24,
  },
  header: {
    marginBottom: 20,
    paddingTop: 45,
  },
  headerBack: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingBottom: 4,
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
    fontSize: 18,
    fontWeight: '600',
    color: TEXT,
    flexShrink: 0,
  },
  pressed: {
    opacity: 0.65,
  },
  pageTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: TEXT,
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 28,
  },
  imageCard: {
    backgroundColor: '#ffffff',
    borderRadius: 13,
    paddingVertical: 16,
    paddingHorizontal: 12,
    marginBottom: 20,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 220,
  },
  diagram: {
    width: '100%',
    height: 350,
  },
  body: {
    paddingHorizontal: 10,
    fontSize: 17,
    lineHeight: 24,
    color: TEXT,
    textAlign: 'center',
    fontWeight: '500',
  },
  doneNotice: {
    marginTop: 12,
    paddingHorizontal: 10,
    fontSize: 15,
    lineHeight: 20,
    color: ORANGE,
    textAlign: 'center',
    fontWeight: '700',
  },
  footer: {
    paddingHorizontal: 25,
    paddingTop: 12,
    paddingBottom: 20,
    backgroundColor: '#ffffff',
  },
  footerRow: {
    flexDirection: 'row',
    gap: 12,
  },
  nextBtn: {
    backgroundColor: ORANGE,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nextBtnFlex: {
    flex: 1,
  },
  nextPressed: {
    opacity: 0.92,
  },
  nextBtnText: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '700',
  },
  backBtn: {
    flex: 1,
    backgroundColor: '#ffffff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: ORANGE,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backPressed: {
    backgroundColor: '#fff3ea',
  },
  backBtnText: {
    color: ORANGE,
    fontSize: 17,
    fontWeight: '700',
  },
});
