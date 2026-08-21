import { useFocusEffect } from '@react-navigation/native';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus, Modal, Pressable, Text, View } from 'react-native';

import { Icon } from '@components/ui/icon';
import { palette, radii, spacing, typography } from '@theme/index';
import { getIncompleteUploadStatus, type IncompleteUploadStatus } from '@/lib/claim-upload-reminder';

/**
 * Mounted on the Home screen only (the post-auth root) — never during login/onboarding.
 * There's no system-notification equivalent available in Expo Go (expo-notifications
 * hard-crashes on Android there), so this is the in-app substitute: every time Home is
 * shown — on login, on returning to Home from elsewhere, or coming back from background —
 * with a Report Accident upload left interrupted, shows a resumable reminder. Styled to
 * match Home's other dialog (the OBD-II pairing prompt): centered surface card with an
 * icon circle, title, message, and a Skip/primary button row.
 */
export function ClaimUploadReminderModal() {
  const [status, setStatus] = useState<IncompleteUploadStatus | null>(null);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  const check = useCallback(() => {
    void getIncompleteUploadStatus().then(setStatus);
  }, []);

  useFocusEffect(check);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      const prev = appStateRef.current;
      appStateRef.current = next;
      if (prev !== 'active' && next === 'active') {
        check();
      }
    });

    return () => sub.remove();
  }, [check]);

  if (!status) {
    return null;
  }

  const dismiss = () => setStatus(null);

  const resume = () => {
    setStatus(null);
    router.push({
      pathname: '/(insurance)/upload-accident-details',
      params: { uploadKey: status.uploadKey, reportedAtIso: status.reportedAtIso },
    });
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={dismiss}>
      <View
        style={{
          flex: 1,
          backgroundColor: palette.overlay,
          alignItems: 'center',
          justifyContent: 'center',
          padding: spacing.xxl,
        }}
      >
        <View
          style={{
            backgroundColor: palette.surface,
            borderRadius: 15,
            padding: spacing.xxl,
            width: '100%',
            gap: spacing.lg,
            alignItems: 'center',
          }}
        >
          <View
            style={{
              width: 64,
              height: 64,
              borderRadius: 32,
              backgroundColor: palette.brandSoft,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon name="CloudUpload" size={32} color={palette.brand} />
          </View>

          <View style={{ gap: spacing.sm, alignItems: 'center' }}>
            <Text style={{ ...typography.h2, color: palette.text, textAlign: 'center' }}>
              Claim Upload Incomplete
            </Text>
            <Text
              style={{
                ...typography.body,
                color: palette.textMuted,
                textAlign: 'center',
                lineHeight: 22,
              }}
            >
              {`${status.percent}% uploaded — resume now to finish submitting your claim.`}
            </Text>
          </View>

          <View style={{ flexDirection: 'row', gap: spacing.md, width: '100%' }}>
            <Pressable
              onPress={dismiss}
              style={({ pressed }) => ({
                flex: 1,
                borderRadius: radii.lg,
                paddingVertical: spacing.md + 2,
                alignItems: 'center',
                borderWidth: 1.5,
                borderColor: palette.border,
                backgroundColor: pressed ? palette.homeBackground : 'transparent',
              })}
            >
              <Text style={{ ...typography.bodyStrong, color: palette.textMuted }}>Later</Text>
            </Pressable>

            <Pressable
              onPress={resume}
              style={({ pressed }) => ({
                flex: 1,
                borderRadius: radii.lg,
                paddingVertical: spacing.md + 2,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: pressed ? palette.brandPressed : palette.brand,
              })}
            >
              <Text style={{ ...typography.bodyStrong, color: palette.textOnBrand }}>Resume Now</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
