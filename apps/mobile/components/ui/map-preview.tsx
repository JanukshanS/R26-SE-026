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

import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import MapView, { Marker, Polyline, PROVIDER_DEFAULT } from "react-native-maps";
import { Icon } from "@components/ui/icon";
import { palette, radii, spacing, typography } from "@theme/index";
import type { ProviderRecord } from "@lib/dispatchApi";
import { providerTypeLabel } from "@lib/dispatchApi";
import { fetchDrivingRoute, type LatLng } from "@lib/route";
import { useT } from "@lib/i18n";

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
  const t = useT();
  const driverLat = driverLocation.latitude;
  const driverLng = driverLocation.longitude;
  const providerLat = provider?.latitude  ?? driverLat;
  const providerLng = provider?.longitude ?? driverLng;

  // Center the camera between the two pins; pad so they're not on the edge.
  const midLat = (driverLat + providerLat) / 2;
  const midLng = (driverLng + providerLng) / 2;
  const latDelta = Math.max(0.02, Math.abs(driverLat - providerLat) * 2.5);
  const lngDelta = Math.max(0.02, Math.abs(driverLng - providerLng) * 2.5);

  // Real driving route, fetched once the provider is known. Null until it
  // arrives, and stays null if routing fails — the polyline below then falls
  // back to the straight line rather than disappearing.
  const [route, setRoute] = useState<LatLng[] | null>(null);
  useEffect(() => {
    if (!provider) {
      setRoute(null);
      return;
    }
    let cancelled = false;
    fetchDrivingRoute(
      { latitude: driverLat, longitude: driverLng },
      { latitude: providerLat, longitude: providerLng },
    ).then((line) => {
      if (!cancelled) setRoute(line);
    });
    return () => {
      cancelled = true;
    };
  }, [provider, driverLat, driverLng, providerLat, providerLng]);

  // Tiles never arriving — an unauthorised Maps key, no network, quota — has
  // no callback, so the map would otherwise spin forever. Fall back to the
  // coordinates, which is the part a provider actually needs.
  const [ready, setReady] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    if (ready) return;
    const t = setTimeout(() => setTimedOut(true), 8000);
    return () => clearTimeout(t);
  }, [ready]);

  if (timedOut && !ready) {
    return (
      <View
        style={{
          height: 240,
          borderRadius: radii.lg,
          borderCurve: "continuous",
          backgroundColor: palette.surfaceMuted,
          alignItems: "center",
          justifyContent: "center",
          gap: spacing.xs,
          padding: spacing.lg,
        }}
      >
        <Icon name="MapPin" size={22} color={palette.textMuted} />
        <Text style={{ ...typography.bodyStrong, color: palette.text }}>
          {t("components.map.unavailable")}
        </Text>
        <Text style={{ ...typography.caption, color: palette.textMuted, textAlign: "center" }}>
          {driverLat.toFixed(4)}, {driverLng.toFixed(4)}
          {distanceText ? ` · ${distanceText}` : ""}
        </Text>
      </View>
    );
  }

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
        // onMapLoaded, not onMapReady: the latter fires once the view is
        // constructed even when tile authorisation later fails.
        onMapLoaded={() => setReady(true)}
      >
        {/* Incident location (driver) */}
        <Marker
          coordinate={{ latitude: driverLat, longitude: driverLng }}
          title={t("components.map.driverPinTitle")}
          description={t("components.map.driverPinDescription")}
          pinColor="red"
        />

        {/* Provider location */}
        {provider && (
          <Marker
            coordinate={{ latitude: providerLat, longitude: providerLng }}
            title={provider.name}
            description={providerTypeLabel(provider.type, t)}
            pinColor="green"
          />
        )}

        {/* The driving route once OSRM answers (solid), otherwise the straight
            line between the two pins (dashed). The dash is deliberate: it reads
            as "approximate" so nobody mistakes the fallback for a real route. */}
        {provider && (
          <Polyline
            // Remount when switching between the two: on Android the native
            // polyline keeps a dash pattern already applied to it, so clearing
            // lineDashPattern alone leaves a real route still drawn dashed.
            key={route ? "route" : "direct"}
            coordinates={
              route ?? [
                { latitude: driverLat,   longitude: driverLng   },
                { latitude: providerLat, longitude: providerLng },
              ]
            }
            strokeColor={palette.brand}
            strokeWidth={route ? 4 : 3}
            lineDashPattern={route ? undefined : [6, 4]}
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
