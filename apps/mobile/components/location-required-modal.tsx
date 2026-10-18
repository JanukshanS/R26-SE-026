import { useSyncExternalStore } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';

import { Icon } from '@components/ui/icon';
import { palette, radii, spacing, typography } from '@theme/index';
import { useT } from '@lib/i18n';
import {
  dismissLocationPrompt,
  getLocationPrompt,
  openLocationSettings,
  subscribeLocationPrompt,
} from '@/lib/require-location';

/** "Location required" pop-up shown after being sent Home from an insurance step.
 * Same icon-circle card style as the home screen's insurance renewal reminder. */
export function LocationRequiredModal() {
  const t = useT();
  const status = useSyncExternalStore(subscribeLocationPrompt, getLocationPrompt);

  return (
    <Modal visible={status !== null} transparent animationType="fade" onRequestClose={dismissLocationPrompt}>
      <View
        style={{
          flex: 1,
          backgroundColor: palette.overlay,
          alignItems: 'center',
          justifyContent: 'center',
          padding: spacing.xl,
        }}
      >
        <View
          style={{
            backgroundColor: palette.surface,
            borderRadius: 15,
            padding: spacing.xl,
            gap: spacing.lg,
            width: '100%',
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
            <Icon name="MapPinOff" size={32} color={palette.brand} />
          </View>

          <View style={{ gap: spacing.sm, alignItems: 'center' }}>
            <Text style={{ ...typography.h2, color: palette.text, textAlign: 'center' }}>
              {t('insurance.location.requiredTitle')}
            </Text>
            <Text style={{ ...typography.body, color: palette.textMuted, textAlign: 'center', lineHeight: 22 }}>
              {t(status === 'off' ? 'insurance.location.off' : 'insurance.location.blocked')}
            </Text>
          </View>

          <View style={{ width: '100%', gap: spacing.sm }}>
            <Pressable
              onPress={() => {
                if (status) openLocationSettings(status);
                dismissLocationPrompt();
              }}
              style={({ pressed }) => ({
                width: '100%',
                backgroundColor: pressed ? palette.brandPressed : palette.brand,
                borderRadius: radii.lg,
                paddingVertical: spacing.md + 2,
                alignItems: 'center',
              })}
            >
              <Text style={{ ...typography.bodyStrong, color: palette.textOnBrand }}>
                {t('insurance.location.openSettings')}
              </Text>
            </Pressable>
            <Pressable
              onPress={dismissLocationPrompt}
              style={({ pressed }) => ({
                width: '100%',
                borderRadius: radii.lg,
                paddingVertical: spacing.md,
                alignItems: 'center',
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <Text style={{ ...typography.bodyStrong, color: palette.textMuted }}>{t('insurance.action.close')}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
