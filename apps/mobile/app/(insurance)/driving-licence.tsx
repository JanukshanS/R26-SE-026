import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import { useMemo, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ResetCaptureDialog } from '@/features/guided-capture/components/reset-capture-dialog';
import { prepareImageForZeroDce } from '@/features/low-light/prepare-image-for-zero-dce';
import {
  deleteDrivingLicencePhotos,
  loadDrivingLicenceState,
  persistDrivingLicencePhoto,
  saveDrivingLicenceState,
} from '@/features/driving-licence/storage/driving-licence-store';
import { snapAndSavePhotoGps } from '@/lib/snap-photo-gps';
import { appendUniqueUri } from '@/lib/uri-utils';
import {
  CAPTURE_ACTION_BLUE,
  CAPTURE_RESET_CANCEL_BORDER,
  INSURANCE_BORDER,
  INSURANCE_CAMERA_PLACEHOLDER_BG,
  INSURANCE_CTA_LINK,
  INSURANCE_PRIMARY,
  INSURANCE_SCREEN_BG,
  INSURANCE_SHADOW_COLOR,
  INSURANCE_TEXT,
  INSURANCE_TEXT_DIM,
  INSURANCE_TEXT_MUTED,
  INSURANCE_THUMBNAIL_BG,
  WHITE,
} from '@/features/guided-capture/capture-ui-theme';

const SELFIE_GUIDE_IMAGE = require('../../assets/images/driving-licence-test-selfie.png');

type LicenceSide = 'front' | 'back' | 'selfie';

export default function DrivingLicencePhotoScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const cameraRef = useRef<CameraView>(null);
  const hydratedStoreRef = useRef(false);
  const [permission, requestPermission] = useCameraPermissions();
  const [side, setSide] = useState<LicenceSide>('front');
  const [frontPreviewUri, setFrontPreviewUri] = useState<string | null>(null);
  const [backPreviewUri, setBackPreviewUri] = useState<string | null>(null);
  const [selfiePreviewUri, setSelfiePreviewUri] = useState<string | null>(null);
  const [libraryUris, setLibraryUris] = useState<string[]>([]);
  const [isTakingPhoto, setIsTakingPhoto] = useState(false);
  const [isResetDialogVisible, setIsResetDialogVisible] = useState(false);

  const cameraFacing = side === 'selfie' ? 'front' : 'back';

  const allImagesCaptured =
    side === 'selfie' && selfiePreviewUri !== null && frontPreviewUri !== null && backPreviewUri !== null;

  const instructionHeadline = useMemo(() => {
    if (allImagesCaptured) {
      return 'All images Captured';
    }
    if (side === 'front') {
      return 'Take a photo of the front of your Driving Licence.';
    }
    if (side === 'back') {
      return 'Take a photo of the other side of your Driving Licence.';
    }
    return 'Take a selfie of yourself with holding the Driving Licence';
  }, [allImagesCaptured, side]);

  const showSelfieGuide = side === 'selfie' && !selfiePreviewUri && !allImagesCaptured;

  const primaryLabel =
    side === 'selfie' && selfiePreviewUri ? 'Retake' : 'Take Photo';

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const state = await loadDrivingLicenceState();
      if (cancelled) {
        return;
      }
      setSide(state.side);
      setFrontPreviewUri(state.frontUri);
      setBackPreviewUri(state.backUri);
      setSelfiePreviewUri(state.selfieUri);
      setLibraryUris(state.libraryUris);
      hydratedStoreRef.current = true;
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hydratedStoreRef.current) {
      return;
    }
    void saveDrivingLicenceState({
      side,
      frontUri: frontPreviewUri,
      backUri: backPreviewUri,
      selfieUri: selfiePreviewUri,
      libraryUris,
    });
  }, [side, frontPreviewUri, backPreviewUri, selfiePreviewUri, libraryUris]);

  const restartFromBeginning = () => {
    const urisToDelete = [...libraryUris];
    setFrontPreviewUri(null);
    setBackPreviewUri(null);
    setSelfiePreviewUri(null);
    setLibraryUris([]);
    setSide('front');
    void deleteDrivingLicencePhotos(urisToDelete);
  };

  const takePhoto = async () => {
    const cam = cameraRef.current;
    if (!cam || isTakingPhoto) return;
    try {
      setIsTakingPhoto(true);
      const capturedAt = new Date().toISOString();
      const photo = await cam.takePictureAsync({
        quality: 0.85,
        skipProcessing: false,
      });
      const uri = photo?.uri;
      if (!uri) {
        Alert.alert('Capture failed', 'No image was saved. Please try again.');
        return;
      }
      const uriForStore = await prepareImageForZeroDce(uri);
      let storedUri = uriForStore;
      try {
        storedUri = await persistDrivingLicencePhoto(uriForStore);
      } catch {
        storedUri = uri;
      }
      void snapAndSavePhotoGps(storedUri, capturedAt);

      if (side === 'front') {
        setFrontPreviewUri(storedUri);
        setLibraryUris((prev) => appendUniqueUri(prev, storedUri));
        setSide('back');
      } else if (side === 'back') {
        setBackPreviewUri(storedUri);
        setLibraryUris((prev) => appendUniqueUri(prev, storedUri));
        setSide('selfie');
      } else if (side === 'selfie') {
        setSelfiePreviewUri(storedUri);
        setLibraryUris((prev) => appendUniqueUri(prev, storedUri));
      }
    } catch {
      Alert.alert('Capture failed', 'Please try again.');
    } finally {
      setIsTakingPhoto(false);
    }
  };

  if (!permission) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'left', 'right', 'bottom']}>
        <View style={styles.center}>
          <Text style={styles.centerText}>Checking camera permission...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'left', 'right', 'bottom']}>
        <View style={styles.center}>
          <Text style={styles.centerText}>Camera access is required to photograph your licence.</Text>
          <Pressable style={styles.permissionButton} onPress={requestPermission}>
            <Text style={styles.permissionButtonText}>Grant Camera Permission</Text>
          </Pressable>
          <Pressable style={styles.textButton} onPress={() => router.back()}>
            <Text style={styles.textButtonLabel}>Go back</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right', 'bottom']}>
      <ResetCaptureDialog
        visible={isResetDialogVisible}
        onCancel={() => setIsResetDialogVisible(false)}
        onConfirm={() => {
          setIsResetDialogVisible(false);
          restartFromBeginning();
        }}
        message="Clear all licence photos and start again?"
      />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
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
                <Ionicons name="chevron-back" size={22} color={COLORS.text} />
              </View>
              <Text style={styles.headerTitle}>Driving Licence Photo</Text>
            </Pressable>
          ) : (
            <Text style={styles.headerTitle}>Driving Licence Photo</Text>
          )}
        </View>

        {showSelfieGuide ? (
          <View style={styles.headlineRow}>
            <Text style={styles.headlineBesideGuide}>{instructionHeadline}</Text>
            <View style={styles.guideBesideHeadline} accessibilityLabel="Example selfie with licence">
              <Image source={SELFIE_GUIDE_IMAGE} style={styles.guideBesideHeadlineImage} resizeMode="cover" />
            </View>
          </View>
        ) : (
          <Text style={styles.headline}>{instructionHeadline}</Text>
        )}
        <Text style={styles.subtitle}>
          This step is required by the insurance company. This will help us to validate you and your vehicle.
        </Text>

        <View style={styles.cameraFrame}>
          <CameraView
            key={`${side}-${cameraFacing}`}
            style={styles.cameraFill}
            facing={cameraFacing}
            ref={cameraRef}
          />
          {side === 'back' && frontPreviewUri ? (
            <View style={styles.cornerAnchor}>
              <View style={styles.cornerPreviewTile} accessibilityLabel="Front of licence preview">
                <Image source={{ uri: frontPreviewUri }} style={styles.cornerPreviewImage} resizeMode="cover" />
              </View>
            </View>
          ) : null}
          {side === 'selfie' && frontPreviewUri && backPreviewUri ? (
            <View style={styles.cornerAnchor}>
              <View style={styles.cornerThumbsRow}>
                <View style={styles.cornerPreviewTile} accessibilityLabel="Back of licence preview">
                  <Image source={{ uri: backPreviewUri }} style={styles.cornerPreviewImage} resizeMode="cover" />
                </View>
                <View style={styles.cornerPreviewTile} accessibilityLabel="Front of licence preview">
                  <Image source={{ uri: frontPreviewUri }} style={styles.cornerPreviewImage} resizeMode="cover" />
                </View>
                {selfiePreviewUri ? (
                  <View style={styles.cornerPreviewTile} accessibilityLabel="Selfie preview">
                    <Image source={{ uri: selfiePreviewUri }} style={styles.cornerPreviewImage} resizeMode="cover" />
                  </View>
                ) : null}
              </View>
            </View>
          ) : null}
        </View>

        <View style={styles.buttonRow}>
          <Pressable
            style={({ pressed }) => [styles.backButton, pressed && styles.backButtonPressed]}
            onPress={() => router.replace('/(insurance)')}>
            <Text style={styles.backButtonText}>Back</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [
              styles.primaryButton,
              pressed && styles.primaryButtonPressed,
              isTakingPhoto && styles.buttonDisabled,
            ]}
            onPress={() => {
              if (side === 'selfie' && selfiePreviewUri) {
                setIsResetDialogVisible(true);
              } else {
                void takePhoto();
              }
            }}
            disabled={isTakingPhoto}>
            {isTakingPhoto ? (
              <ActivityIndicator color={WHITE} />
            ) : (
              <Text style={styles.primaryButtonText}>{primaryLabel}</Text>
            )}
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const COLORS = {
  text: INSURANCE_TEXT,
  textMuted: INSURANCE_TEXT_MUTED,
  screen: INSURANCE_SCREEN_BG,
  border: INSURANCE_BORDER,
};

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: COLORS.screen,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 28,
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
    color: COLORS.text,
    flexShrink: 0,
  },
  headline: {
    fontSize: 22,
    fontWeight: '700',
    color: COLORS.text,
    lineHeight: 30,
    marginBottom: 10,
  },
  headlineRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 10,
  },
  headlineBesideGuide: {
    flex: 1,
    fontSize: 22,
    fontWeight: '700',
    color: COLORS.text,
    lineHeight: 30,
  },
  /** Portrait frame for tall guide art (width:height ≈ 0.72 → visibly taller than 1:1). */
  guideBesideHeadline: {
    width: 70,
    aspectRatio: 0.86,
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: COLORS.text,
    backgroundColor: WHITE,
    flexShrink: 0,
    marginRight: 10,
  },
  guideBesideHeadlineImage: {
    width: '100%',
    height: '100%',
  },
  subtitle: {
    fontSize: 16,
    color: COLORS.textMuted,
    lineHeight: 22,
    marginBottom: 15,
  },
  cameraFrame: {
    width: '100%',
    maxWidth: 400,
    alignSelf: 'center',
    aspectRatio: 1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
    backgroundColor: INSURANCE_CAMERA_PLACEHOLDER_BG,
    position: 'relative',
    marginBottom: 24,
  },
  cameraFill: {
    width: '100%',
    height: '100%',
  },
  cornerAnchor: {
    position: 'absolute',
    bottom: 10,
    right: 10,
  },
  cornerThumbsRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },
  cornerPreviewTile: {
    width: 72,
    height: 72,
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: WHITE,
    backgroundColor: INSURANCE_THUMBNAIL_BG,
    shadowColor: INSURANCE_SHADOW_COLOR,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.25,
    shadowRadius: 3,
    elevation: 4,
  },
  cornerPreviewImage: {
    width: '100%',
    height: '100%',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
    maxWidth: 400,
    alignSelf: 'center',
    width: '100%',
  },
  backButton: {
    flex: 1,
    backgroundColor: WHITE,
    borderWidth: 1,
    borderColor: CAPTURE_RESET_CANCEL_BORDER,
    borderRadius: 8,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backButtonPressed: {
    opacity: 0.88,
  },
  backButtonText: {
    color: CAPTURE_ACTION_BLUE,
    fontSize: 17,
    fontWeight: '700',
  },
  primaryButton: {
    flex: 1,
    backgroundColor: INSURANCE_PRIMARY,
    borderRadius: 10,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonPressed: {
    opacity: 0.92,
  },
  primaryButtonText: {
    color: WHITE,
    fontSize: 17,
    fontWeight: '700',
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  pressed: {
    opacity: 0.65,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    gap: 16,
  },
  centerText: {
    color: INSURANCE_TEXT_DIM,
    textAlign: 'center',
    fontSize: 16,
    lineHeight: 22,
  },
  permissionButton: {
    backgroundColor: INSURANCE_PRIMARY,
    borderRadius: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  permissionButtonText: {
    color: WHITE,
    fontWeight: '700',
    fontSize: 16,
  },
  textButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  textButtonLabel: {
    color: INSURANCE_CTA_LINK,
    fontSize: 16,
    fontWeight: '600',
  },
});
