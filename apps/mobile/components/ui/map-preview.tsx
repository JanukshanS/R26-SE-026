/**
 * MapPreview (native) — react-native-maps with driver pin + provider pin
 * + a polyline from one to the other. Used on the "Connected to Mechanic"
 * screen.
 *
 * Metro picks this file on iOS / Android. For web it loads map-preview.web.tsx
 * (a placeholder) — react-native-maps is a native module and crashes the
 * web bundle if imported directly.
 *
 * @author Janukshan Sivakumar - IT22635266
 */

import { Text, View } from "react-native";
import MapView, { Marker, Polyline, PROVIDER_DEFAULT } from "react-native-maps";
import { Icon } from "@components/ui/icon";
import { palette, radii, spacing, typography } from "@theme/index";
import type { ProviderRecord } from "@lib/dispatchApi";
import { providerTypeLabel } from "@lib/dispatchApi";

interface MapPreviewProps {
  driverLocation: { latitude: number; longitude: number };
  provider:       ProviderRecord | null;
  /** Optional ETA + distance overlay shown at the bottom-left of the map. */
  etaText?:       string | null;
  distanceText?:  string | null;
}

export function MapPreview({
  driverLocation,
  provider,
  etaText,
  distanceText,
}: MapPreviewProps) {
  const driverLat = driverLocation.latitude;
  const driverLng = driverLocation.longitude;
  const providerLat = provider?.latitude  ?? driverLat;
  const providerLng = provider?.longitude ?? driverLng;

  // Center the camera between the two pins; pad so they're not on the edge.
  const midLat = (driverLat + providerLat) / 2;
  const midLng = (driverLng + providerLng) / 2;
  const latDelta = Math.max(0.02, Math.abs(driverLat - providerLat) * 2.5);
  const lngDelta = Math.max(0.02, Math.abs(driverLng - providerLng) * 2.5);

  return (
    <View
      style={{
        height: 240,
        borderRadius: radii.lg,
        borderCurve: "continuous",
        overflow: "hidden",
        backgroundColor: palette.surfaceMuted,
        position: "relative",
      }}
    >
      <MapView
        provider={PROVIDER_DEFAULT}
        style={{ flex: 1 }}
        initialRegion={{
          latitude:       midLat,
          longitude:      midLng,
          latitudeDelta:  latDelta,
          longitudeDelta: lngDelta,
        }}
        showsUserLocation={false}
        toolbarEnabled={false}
        loadingEnabled
      >
        {/* Incident location (driver) */}
        <Marker
          coordinate={{ latitude: driverLat, longitude: driverLng }}
          title="You"
          description="Incident location"
          pinColor="red"
        />

        {/* Provider location */}
        {provider && (
          <Marker
            coordinate={{ latitude: providerLat, longitude: providerLng }}
            title={provider.name}
            description={providerTypeLabel(provider.type)}
            pinColor="green"
          />
        )}

        {/* Straight-line route between them — a real driving route would
            need Google Directions API; this is good enough for the demo. */}
        {provider && (
          <Polyline
            coordinates={[
              { latitude: driverLat,   longitude: driverLng   },
              { latitude: providerLat, longitude: providerLng },
            ]}
            strokeColor={palette.brand}
            strokeWidth={3}
            lineDashPattern={[6, 4]}
          />
        )}
      </MapView>

      {/* ETA + distance overlay (matches the reference UI) */}
      {(etaText || distanceText) && (
        <View
          style={{
            position: "absolute",
            bottom: spacing.md,
            left: spacing.md,
            right: spacing.md,
            backgroundColor: palette.surface,
            borderRadius: radii.md,
            paddingVertical: spacing.sm,
            paddingHorizontal: spacing.md,
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
            gap: spacing.md,
            // soft shadow so the overlay reads cleanly over the map
            shadowColor: "#000",
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.12,
            shadowRadius: 6,
            elevation: 4,
          }}
        >
          {etaText && (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Icon name="Clock" size={14} color={palette.brand} />
              <Text style={{ ...typography.bodyStrong, color: palette.text }}>
                {etaText}
              </Text>
            </View>
          )}
          {distanceText && (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Icon name="MapPin" size={14} color={palette.brand} />
              <Text style={{ ...typography.bodyStrong, color: palette.text }}>
                {distanceText}
              </Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
}
