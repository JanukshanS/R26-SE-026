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
  deleteThirdPartyPhotos,
  loadThirdPartyState,
  nextStepAfterCapture,
  persistThirdPartyPhoto,
  saveThirdPartyState,
  type ThirdPartyCaptureStep,
} from '@/features/third-party/storage/third-party-store';
import { snapAndSavePhotoGps } from '@/lib/snap-photo-gps';
import { appendUniqueUri } from '@/lib/uri-utils';

const CTA_BLUE = '#1565c0';
const PRIMARY_BLUE = '#1f8bff';

export default function ThirdPartyDetailsScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const cameraRef = useRef<CameraView>(null);
  const hydratedStoreRef = useRef(false);
  const [permission, requestPermission] = useCameraPermissions();
  const [step, setStep] = useState<ThirdPartyCaptureStep>('driverFront');
  const [driverLicenceFrontUri, setDriverLicenceFrontUri] = useState<string | null>(null);
  const [driverLicenceBackUri, setDriverLicenceBackUri] = useState<string | null>(null);
  const [revenueLicenceUri, setRevenueLicenceUri] = useState<string | null>(null);
  const [notApplicable, setNotApplicable] = useState(false);
  const [libraryUris, setLibraryUris] = useState<string[]>([]);
  const [isTakingPhoto, setIsTakingPhoto] = useState(false);
  const [isResetDialogVisible, setIsResetDialogVisible] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const thirdState = await loadThirdPartyState();
      if (cancelled) {
        return;
      }
      setStep(thirdState.step);
      setDriverLicenceFrontUri(thirdState.driverLicenceFrontUri);
      setDriverLicenceBackUri(thirdState.driverLicenceBackUri);
      setRevenueLicenceUri(thirdState.revenueLicenceUri);
      setNotApplicable(thirdState.notApplicable);
      setLibraryUris(thirdState.libraryUris);
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
    void saveThirdPartyState({
      step,
      driverLicenceFrontUri,
      driverLicenceBackUri,
      revenueLicenceUri,
      notApplicable,
      libraryUris,
    });
  }, [step, driverLicenceFrontUri, driverLicenceBackUri, revenueLicenceUri, notApplicable, libraryUris]);

  const allImagesCaptured =
    driverLicenceFrontUri != null && driverLicenceBackUri != null && revenueLicenceUri != null;

  const headline = useMemo(() => {
    if (allImagesCaptured) {
      return 'All images Captured';
    }
    if (step === 'driverFront') {
      return "Take an image of the 3rd party vehicle's Driver Licence.";
    }
    if (step === 'driverBack') {
      return "Take an image of the other side of the 3rd party vehicle's Driver Licence.";
    }
    return "Take an image of the 3rd party vehicle's revenue licence.";
  }, [allImagesCaptured, step]);

  const hasAnyPhoto =
    driverLicenceFrontUri != null || driverLicenceBackUri != null || revenueLicenceUri != null;

  const restartFromBeginning = () => {
    const urisToDelete = [...libraryUris];
    setDriverLicenceFrontUri(null);
    setDriverLicenceBackUri(null);
    setRevenueLicenceUri(null);
    setLibraryUris([]);
    setStep('driverFront');
    setNotApplicable(false);
    void deleteThirdPartyPhotos(urisToDelete);
  };

  const onTakePhoto = async () => {
    if (allImagesCaptured) {
      setIsResetDialogVisible(true);
      return;
    }

    const cam = cameraRef.current;
    if (!cam || isTakingPhoto) {
      return;
    }
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
        storedUri = await persistThirdPartyPhoto(uriForStore);
      } catch {
        storedUri = uri;
      }
      void snapAndSavePhotoGps(storedUri, capturedAt);
      setNotApplicable(false);
      setLibraryUris((prev) => appendUniqueUri(prev, storedUri));

      if (step === 'driverFront') {
        setDriverLicenceFrontUri(storedUri);
        setStep(nextStepAfterCapture('driverFront'));
      } else if (step === 'driverBack') {
        setDriverLicenceBackUri(storedUri);
        setStep(nextStepAfterCapture('driverBack'));
      } else {
        setRevenueLicenceUri(storedUri);
      }
    } catch {
      Alert.alert('Capture failed', 'Please try again.');
    } finally {
      setIsTakingPhoto(false);
    }
  };

  const onNotApplicable = () => {
    if (hasAnyPhoto) {
      return;
    }
    Alert.alert(
      'Not applicable?',
      'Use this only if there is no third-party vehicle or documents to photograph. You can complete these photos later from this step.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm',
          onPress: () => {
            void (async () => {
              await saveThirdPartyState({
                step: 'driverFront',
                driverLicenceFrontUri: null,
                driverLicenceBackUri: null,
                revenueLicenceUri: null,
                notApplicable: true,
                libraryUris: [],
              });
              router.back();
            })();
          },
        },
      ]
    );
  };

  const primaryLabel = allImagesCaptured ? 'Retake' : 'Take Photo';

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
          <Text style={styles.centerText}>
            Camera access is required to photograph the third party&apos;s licence and revenue licence.
          </Text>
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
        message="Clear all third-party photos and start again?"
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
              <Text style={styles.headerTitle}>3rd Party Details</Text>
            </Pressable>
          ) : (
            <Text style={styles.headerTitle}>3rd Party Details</Text>
          )}
        </View>

        <Text style={styles.headline}>{headline}</Text>
        <Text style={styles.subtitle}>This step is required by the insurance company for all third-party cases.</Text>

        <View style={styles.cameraFrame}>
          <CameraView key={step} ref={cameraRef} style={styles.cameraFill} facing="back" />
          {step === 'driverBack' && driverLicenceFrontUri ? (
            <View style={styles.cornerAnchor}>
              <View style={styles.cornerPreviewTile} accessibilityLabel="3rd party driver licence front preview">
                <Image source={{ uri: driverLicenceFrontUri }} style={styles.cornerPreviewImage} resizeMode="cover" />
              </View>
            </View>
          ) : null}
          {step === 'revenue' && driverLicenceFrontUri && driverLicenceBackUri ? (
            <View style={styles.cornerAnchor}>
              <View style={styles.cornerThumbsRow}>
                <View style={styles.cornerPreviewTile} accessibilityLabel="3rd party driver licence back preview">
                  <Image source={{ uri: driverLicenceBackUri }} style={styles.cornerPreviewImage} resizeMode="cover" />
                </View>
                <View style={styles.cornerPreviewTile} accessibilityLabel="3rd party driver licence front preview">
                  <Image source={{ uri: driverLicenceFrontUri }} style={styles.cornerPreviewImage} resizeMode="cover" />
                </View>
                {revenueLicenceUri ? (
                  <View style={styles.cornerPreviewTile} accessibilityLabel="3rd party revenue licence preview">
                    <Image source={{ uri: revenueLicenceUri }} style={styles.cornerPreviewImage} resizeMode="cover" />
                  </View>
                ) : null}
              </View>
            </View>
          ) : null}
        </View>

        <Pressable
          style={({ pressed }) => [styles.primaryButton, pressed && styles.primaryButtonPressed, isTakingPhoto && styles.buttonDisabled]}
          onPress={() => void onTakePhoto()}
          disabled={isTakingPhoto}>
          {isTakingPhoto ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.primaryButtonText}>{primaryLabel}</Text>
          )}
        </Pressable>

        <Pressable
          style={({ pressed }) => [
            styles.secondaryButton,
            pressed && styles.secondaryButtonPressed,
            hasAnyPhoto || notApplicable ? styles.secondaryButtonDisabled : null,
          ]}
          onPress={onNotApplicable}
          disabled={hasAnyPhoto || notApplicable}>
          <Text
            style={[
              styles.secondaryButtonText,
              hasAnyPhoto || notApplicable ? styles.secondaryButtonTextDisabled : null,
            ]}>
            Not Applicable
          </Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const COLORS = {
  text: '#111111',
  textMuted: '#666666',
  screen: '#efefef',
  border: '#d0d0d0',
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
    paddingTop: 50,
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
  subtitle: {
    fontSize: 16,
    color: COLORS.textMuted,
    lineHeight: 22,
    marginBottom: 15
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
    backgroundColor: '#d8d8d8',
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
    borderColor: '#fff',
    backgroundColor: '#ccc',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.25,
    shadowRadius: 3,
    elevation: 4,
  },
  cornerPreviewImage: {
    width: '100%',
    height: '100%',
  },
  primaryButton: {
    backgroundColor: PRIMARY_BLUE,
    borderRadius: 10,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
    maxWidth: 400,
    alignSelf: 'center',
    width: '100%',
  },
  primaryButtonPressed: {
    opacity: 0.92,
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
  },
  secondaryButton: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    maxWidth: 400,
    alignSelf: 'center',
    width: '100%',
  },
  secondaryButtonPressed: {
    backgroundColor: '#f8f8f8',
  },
  secondaryButtonDisabled: {
    opacity: 0.45,
  },
  secondaryButtonText: {
    color: COLORS.text,
    fontSize: 17,
    fontWeight: '700',
  },
  secondaryButtonTextDisabled: {
    color: COLORS.textMuted,
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
    color: '#333',
    textAlign: 'center',
    fontSize: 16,
    lineHeight: 22,
  },
  permissionButton: {
    backgroundColor: PRIMARY_BLUE,
    borderRadius: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  permissionButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 16,
  },
  textButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  textButtonLabel: {
    color: CTA_BLUE,
    fontSize: 16,
    fontWeight: '600',
  },
});
