import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import * as Location from 'expo-location';
import type { LocationGeocodedAddress } from 'expo-location';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { InsuranceBottomTabBar, type InsuranceTabId } from '@/components/insurance-bottom-tab-bar';
import { loadClaimantProfile, saveClaimantProfile } from '@/features/claimant/storage/claimant-profile-store';
import {
  getPersistedSuccessfulClaimUploadKey,
  setPersistedSuccessfulClaimUploadKey,
  savePersistedClaimLocation,
  loadPersistedClaimLocation,
} from '@/lib/claim-upload-dedupe';
import { uploadFullClaimBundleToBackend } from '@/lib/capture-api';
import { loadInsurerCallMeta } from '@/features/insurer-call/storage/insurer-call-store';
import { loadGuidedCaptureEntryMeta } from '@/features/guided-capture/storage/guided-capture-entry-store';
import { loadReportAccidentEntryMeta } from '@/features/report-accident/storage/report-accident-entry-store';

const INSURER_PHONE_TEL = 'tel:+94112303300';

const COLORS = {
  screen: '#ffffff',
  text: '#111111',
  textMuted: '#9e9e9e',
  border: '#e0e0e0',
  success: '#22c55e',
  cardBorder: '#ff6b35',
};

function formatGeocodedLine(a: LocationGeocodedAddress): string {
  const parts: string[] = [];
  const streetLine = [a.streetNumber, a.street].filter(Boolean).join(' ').trim();
  if (streetLine) {
    parts.push(streetLine);
  }
  const cityLine = [a.district ?? a.subregion, a.city].filter(Boolean).join(', ');
  if (cityLine) {
    parts.push(cityLine);
  }
  if (a.region) {
    parts.push(a.region);
  }
  if (a.country) {
    parts.push(a.country);
  }
  const s = parts.join(', ').replace(/,\s*,/g, ',').trim();
  return s || 'Address unavailable';
}

function formatTimestamp(d: Date): string {
  return d.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}

function ProgressRow({
  label,
  percent,
  complete,
}: {
  label: string;
  percent: number;
  complete: boolean;
}) {
  const pct = complete ? 100 : Math.max(0, Math.min(100, Math.round(percent)));
  const showDone = complete;
  return (
    <View style={styles.progressRow}>
      <View style={styles.progressRowLeft}>
        <Ionicons
          name={showDone ? 'checkmark-circle' : 'ellipse-outline'}
          size={22}
          color={showDone ? COLORS.success : COLORS.textMuted}
          style={styles.progressIcon}
        />
        <Text style={styles.progressLabel}>{label}</Text>
      </View>
      <Text style={[styles.progressPercent, !showDone && styles.progressPercentPending]}>
        {showDone ? '100%' : `${pct}%`}
      </Text>
    </View>
  );
}

export default function UploadAccidentDetailsScreen() {
  const router = useRouter();
  const { uploadKey, reportedAtIso } = useLocalSearchParams<{ uploadKey?: string; reportedAtIso?: string }>();
  const [locationLine, setLocationLine] = useState<string>('Getting location…');
  const [timestampLine, setTimestampLine] = useState<string>('');
  const [locationLoading, setLocationLoading] = useState(true);
  /** Guided capture → backend upload progress (starts when opening this screen from Report Accident). */
  const [photosUploadPercent, setPhotosUploadPercent] = useState(0);
  const [photosUploadComplete, setPhotosUploadComplete] = useState(false);
  const [fraudValidationPercent, setFraudValidationPercent] = useState(0);
  const [fraudValidationComplete, setFraudValidationComplete] = useState(false);
  const photosUploadedForKeyRef = useRef<string | null>(null);
  /** Used so a failure after walkaround uploads still leaves the Photos row green. */
  const guidedWalkaroundUploadsDoneRef = useRef(false);
  const fraudValidationMediaUploadsDoneRef = useRef(false);
  const [claimantName, setClaimantName] = useState('');
  const [claimantNic, setClaimantNic] = useState('');
  const [claimantLicence, setClaimantLicence] = useState('');
  const [claimantHydrated, setClaimantHydrated] = useState(false);
  const claimantRef = useRef({ fullName: '', nic: '', licenceNumber: '' });

  useLayoutEffect(() => {
    claimantRef.current = {
      fullName: claimantName,
      nic: claimantNic,
      licenceNumber: claimantLicence,
    };
  }, [claimantName, claimantNic, claimantLicence]);

  useEffect(() => {
    let cancelled = false;
    void loadClaimantProfile().then((p) => {
      if (cancelled) {
        return;
      }
      setClaimantName(p.fullName);
      setClaimantNic(p.nic);
      setClaimantLicence(p.licenceNumber);
      setClaimantHydrated(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (!claimantHydrated) {
        return () => {};
      }
      let cancelled = false;
      setLocationLoading(true);
      setLocationLine('Getting location…');
      setTimestampLine('');

      void (async () => {
        const recordedAt = reportedAtIso ? new Date(reportedAtIso) : new Date();

        // Skip GPS entirely if this upload key was already completed.
        if (uploadKey) {
          const persistedSuccessKey = await getPersistedSuccessfulClaimUploadKey();
          if (!cancelled && persistedSuccessKey === uploadKey) {
            photosUploadedForKeyRef.current = uploadKey;
            setPhotosUploadPercent(100);
            setPhotosUploadComplete(true);
            setFraudValidationPercent(100);
            setFraudValidationComplete(true);
            const saved = await loadPersistedClaimLocation();
            if (!cancelled) {
              if (saved) {
                setLocationLine(saved.locationLine);
                setTimestampLine(saved.timestampLine);
              }
              setLocationLoading(false);
            }
            return;
          }
          if (!cancelled && photosUploadedForKeyRef.current === uploadKey) {
            setPhotosUploadPercent(100);
            setPhotosUploadComplete(true);
            setFraudValidationPercent(100);
            setFraudValidationComplete(true);
            const saved = await loadPersistedClaimLocation();
            if (!cancelled) {
              if (saved) {
                setLocationLine(saved.locationLine);
                setTimestampLine(saved.timestampLine);
              }
              setLocationLoading(false);
            }
            return;
          }
        }

        let lat: number | null = null;
        let lng: number | null = null;
        let line = 'Getting location…';

        const persistedEntryMeta = await loadReportAccidentEntryMeta();
        if (!cancelled && persistedEntryMeta?.latitude != null && persistedEntryMeta?.longitude != null) {
          lat = persistedEntryMeta.latitude;
          lng = persistedEntryMeta.longitude;
          line = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
          try {
            const [geo] = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
            if (geo && !cancelled) {
              line = formatGeocodedLine(geo);
            }
          } catch {
            // keep coordinates
          }
          if (!cancelled) {
            setLocationLine(line);
            setTimestampLine(formatTimestamp(recordedAt));
            setLocationLoading(false);
          }
        } else {
          try {
            const { status } = await Location.requestForegroundPermissionsAsync();
            if (cancelled) {
              return;
            }
            if (status !== 'granted') {
              line = 'Location permission not granted';
              if (!cancelled) {
                setLocationLine(line);
                setTimestampLine(formatTimestamp(recordedAt));
              }
            } else {
              const pos = await Location.getCurrentPositionAsync({
                accuracy: Location.Accuracy.Balanced,
              });
              if (cancelled) {
                return;
              }
              lat = pos.coords.latitude;
              lng = pos.coords.longitude;
              line = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
              try {
                const [geo] = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
                if (geo && !cancelled) {
                  line = formatGeocodedLine(geo);
                }
              } catch {
                // keep coordinates
              }
              if (!cancelled) {
                setLocationLine(line);
                setTimestampLine(formatTimestamp(recordedAt));
              }
            }
          } catch {
            if (!cancelled) {
              line = 'Could not read location';
              setLocationLine(line);
              setTimestampLine(formatTimestamp(recordedAt));
            }
          } finally {
            if (!cancelled) {
              setLocationLoading(false);
            }
          }
        }

        if (cancelled || !uploadKey) {
          return;
        }

        // Block upload if GPS location was not obtained.
        // lat is null when permission was denied or reading failed.
        if (lat === null) {
          Alert.alert(
            'Location required',
            'We could not get your GPS location. Please enable location access and try again.',
            [{ text: 'OK' }]
          );
          return;
        }
        setPhotosUploadPercent(0);
        setPhotosUploadComplete(false);
        setFraudValidationPercent(0);
        setFraudValidationComplete(false);
        guidedWalkaroundUploadsDoneRef.current = false;
        fraudValidationMediaUploadsDoneRef.current = false;
        try {
          const [saved, insurerCallMeta, guidedCaptureEntryMeta] = await Promise.all([
            loadClaimantProfile(),
            loadInsurerCallMeta(),
            loadGuidedCaptureEntryMeta(),
          ]);
          const claimant = {
            fullName: (claimantRef.current.fullName || saved.fullName).trim(),
            nic: (claimantRef.current.nic || saved.nic).trim(),
            licenceNumber: (claimantRef.current.licenceNumber || saved.licenceNumber).trim(),
          };
          await saveClaimantProfile(claimant);
          await uploadFullClaimBundleToBackend({
            insurerCallMeta,
            guidedCaptureEntryMeta,
            onGuidedProgress: (p) => {
              if (!cancelled) {
                setPhotosUploadPercent(p);
              }
            },
            onFraudProgress: (p) => {
              if (!cancelled) {
                setFraudValidationPercent(p);
              }
            },
            onGuidedWalkaroundUploadsComplete: () => {
              if (!cancelled) {
                guidedWalkaroundUploadsDoneRef.current = true;
                setPhotosUploadPercent(100);
                setPhotosUploadComplete(true);
              }
            },
            onFraudValidationMediaUploadsComplete: () => {
              if (!cancelled) {
                fraudValidationMediaUploadsDoneRef.current = true;
                setFraudValidationPercent(100);
                setFraudValidationComplete(true);
              }
            },
            report: {
              capturedAtIso: recordedAt.toISOString(),
              capturedAtDisplayLocal: formatTimestamp(recordedAt),
              gpsLat: lat,
              gpsLng: lng,
              locationLabel: line,
            },
            claimant: {
              fullName: claimant.fullName,
              nic: claimant.nic,
              licenceNumber: claimant.licenceNumber,
            },
          });
          if (!cancelled) {
            photosUploadedForKeyRef.current = uploadKey;
            await setPersistedSuccessfulClaimUploadKey(uploadKey);
            await savePersistedClaimLocation({ locationLine: line, timestampLine: formatTimestamp(recordedAt) });
          }
        } catch (e) {
          if (!cancelled) {
            const message = e instanceof Error ? e.message : 'Upload failed';
            if (!guidedWalkaroundUploadsDoneRef.current) {
              setPhotosUploadPercent(0);
              setPhotosUploadComplete(false);
            }
            if (!fraudValidationMediaUploadsDoneRef.current) {
              setFraudValidationPercent(0);
              setFraudValidationComplete(false);
            }
            Alert.alert('Photos upload failed', message);
          }
        }
      })();

      return () => {
        cancelled = true;
      };
    }, [uploadKey, claimantHydrated])
  );

  const onCallInsurer = async () => {
    try {
      await Linking.openURL(INSURER_PHONE_TEL);
    } catch {
      Alert.alert('Call your insurer', 'Use the phone number on your insurance card or policy document.');
    }
  };

  const onTabPress = (tab: InsuranceTabId) => {
    if (tab === 'home') {
      router.push('/(insurance)');
      return;
    }
    Alert.alert('Coming soon', 'This section will be added in a future update.');
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <View style={styles.shell}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}>
          <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => [styles.headerBack, pressed && styles.pressed]}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Go back">
            <Ionicons name="chevron-back" size={24} color={COLORS.text} />
            <Text style={styles.headerBackText}>Report Accident</Text>
          </Pressable>

          <Text style={styles.pageTitle}>Upload Accident Details</Text>

          {/* <Text style={styles.sectionTitle}>Your details</Text>
          <Text style={styles.sectionHint}>Saved on this device and sent with your photos to storage.</Text>
          <View style={styles.claimantBlock}>
            <Text style={styles.fieldLabel}>Full name</Text>
            <TextInput
              style={styles.textInput}
              value={claimantName}
              onChangeText={setClaimantName}
              placeholder="As on your licence"
              placeholderTextColor={COLORS.textMuted}
              autoCapitalize="words"
              editable={!photosUploadComplete}
            />
            <Text style={styles.fieldLabel}>NIC</Text>
            <TextInput
              style={styles.textInput}
              value={claimantNic}
              onChangeText={setClaimantNic}
              placeholder="National Identity Card number"
              placeholderTextColor={COLORS.textMuted}
              autoCapitalize="characters"
              editable={!photosUploadComplete}
            />
            <Text style={styles.fieldLabel}>Driving licence number</Text>
            <TextInput
              style={styles.textInput}
              value={claimantLicence}
              onChangeText={setClaimantLicence}
              placeholder="Licence number"
              placeholderTextColor={COLORS.textMuted}
              autoCapitalize="characters"
              editable={!photosUploadComplete}
            />
          </View> */}

          <View style={styles.progressBlock}>
            <ProgressRow
              label="Photos Uploaded"
              percent={photosUploadPercent}
              complete={photosUploadComplete}
            />
            <ProgressRow
              label="Fraud Validation"
              percent={fraudValidationPercent}
              complete={fraudValidationComplete}
            />
            <ProgressRow label="Low light enhancement" percent={0} complete={false} />
            <ProgressRow label="3D Reconstruction" percent={0} complete={false} />

          </View>

          <View style={styles.detailCard}>
            <View style={styles.detailCardHeader}>
              <Text style={styles.detailCardHeaderLeft}>Captured and Submitted</Text>
              {/* <Text
                style={[
                  styles.detailCardHeaderPct,
                  locationCapturedPct < 100 ? styles.detailCardHeaderPctPending : null,
                ]}>
                {locationCapturedPct}%
              </Text> */}
            </View>
            <View style={styles.detailLocationRow}>
              {locationLoading ? (
                <ActivityIndicator size="small" color={COLORS.textMuted} style={styles.detailSpinner} />
              ) : null}
              <Text style={styles.detailAddress}>{locationLine}</Text>
            </View>
            <Text style={styles.detailTime}>
              {timestampLine || (locationLoading ? '…' : formatTimestamp(new Date()))}
            </Text>
            <Text style={styles.detailFooter}>
              GPS + Timestamp signed. You can close the App - Do not disconnect from Internet. We'll notify you.
            </Text>
          </View>

          <Pressable style={({ pressed }) => [styles.insuranceRowBtn, pressed && styles.insuranceRowPressed]}>
            <Text style={styles.insuranceRowLabel}>Insurance</Text>
            <Text style={styles.insuranceRowStatus}>Pending</Text>
          </Pressable>

          <Pressable
            style={({ pressed }) => [styles.callInsurerBtn, pressed && styles.callInsurerPressed]}
            onPress={onCallInsurer}>
            <Text style={styles.callInsurerText}>Need to call Allianz Insurance ?</Text>
          </Pressable>
        </ScrollView>

        <InsuranceBottomTabBar onTabPress={onTabPress} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: COLORS.screen,
  },
  shell: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 30,
    paddingBottom: 16,
  },
  headerBack: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 31,
    marginBottom: 20,
    paddingTop: 20,
    paddingBottom: 4,
    alignSelf: 'flex-start',
  },
  headerBackText: {
    fontSize: 17,
    fontWeight: '600',
    color: COLORS.text,
  },
  pressed: {
    opacity: 0.65,
  },
  pageTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: COLORS.text,
    marginBottom: 25,
  },
  progressBlock: {
    marginBottom: 20,
    gap: 16,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 6,
  },
  sectionHint: {
    fontSize: 13,
    lineHeight: 18,
    color: COLORS.textMuted,
    marginBottom: 14,
  },
  claimantBlock: {
    marginBottom: 20,
    gap: 10,
  },
  fieldLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 2,
  },
  textInput: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: COLORS.text,
    backgroundColor: '#fafafa',
    marginBottom: 4,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  progressRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 12,
  },
  progressIcon: {
    marginRight: 10,
  },
  progressLabel: {
    fontSize: 18,
    fontWeight: '400',
    color: COLORS.text,
    flex: 1,
  },
  progressPercent: {
    fontSize: 18,
    fontWeight: '500',
    paddingRight: 9,
  },
  progressPercentPending: {
    color: COLORS.textMuted,
  },
  detailCard: {
    marginTop: 20,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    backgroundColor: COLORS.screen,
  },
  detailCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  detailCardHeaderLeft: {
    fontSize: 18,
    fontWeight: '400',
    color: COLORS.text,
    flex: 1,
    marginRight: 8,
  },
  detailCardHeaderPct: {
    fontSize: 18,
    fontWeight: '400',
    color: COLORS.success,
  },
  detailCardHeaderPctPending: {
    color: COLORS.textMuted,
  },
  detailLocationRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: 6,
  },
  detailSpinner: {
    marginTop: 4,
  },
  detailAddress: {
    fontSize: 20,
    fontWeight: '600',
    color: COLORS.text,
    flex: 1,
  },
  detailTime: {
    fontSize: 20,
    fontWeight: '600',
    color: COLORS.text,
    marginTop: 4,
    marginBottom: 14,
  },
  detailFooter: {
    fontSize: 14,
    lineHeight: 20,
    color: COLORS.textMuted,
  },
  insuranceRowBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.screen,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  insuranceRowPressed: {
    backgroundColor: '#fafafa',
  },
  insuranceRowLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
  },
  insuranceRowStatus: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.textMuted,
  },
  callInsurerBtn: {
    backgroundColor: COLORS.screen,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  callInsurerPressed: {
    backgroundColor: '#f5f5f5',
  },
  callInsurerText: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.text,
  },
});
