/**
 * Canvas heatmap overlay for the Google basemap.
 *
 * `google.maps.visualization.HeatmapLayer` was REMOVED in Maps JavaScript API
 * v3.65 — not deprecated, removed: constructing one throws. Google offers no
 * drop-in replacement, and the Leaflet engine's `leaflet.heat` inlines its
 * renderer rather than exporting it, so there is nothing to reuse.
 *
 * This is the same two-pass algorithm `leaflet.heat` uses, which is why the
 * two engines produce a comparable picture: paint every point as a greyscale
 * radial blob so overlapping points accumulate alpha, then recolour each pixel
 * by looking its alpha up in a gradient ramp.
 */

export type HeatPoint = { lat: number; lng: number; weight: number };

interface HeatOptions {
  /** Blob radius in screen pixels, independent of zoom. */
  radius?: number;
  opacity?: number;
}

/** Same stops as the Leaflet engine's gradient, so a hot area reads the same red. */
const GRADIENT: Array<[number, string]> = [
  [0.0, "rgba(34,197,94,0)"],
  [0.3, "#22c55e"],
  [0.55, "#eab308"],
  [0.8, "#f97316"],
  [1.0, "#ef4444"],
];

/** 256×1 lookup strip: alpha byte in, RGB out. Built once per overlay. */
function gradientRamp(): Uint8ClampedArray {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 1;
  const ctx = c.getContext("2d")!;
  const g = ctx.createLinearGradient(0, 0, 256, 0);
  GRADIENT.forEach(([stop, color]) => g.addColorStop(stop, color));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 1);
  return ctx.getImageData(0, 0, 256, 1).data;
}

/** One pre-rendered blob, stamped once per point — cheaper than a gradient each time. */
function blobStamp(radius: number): HTMLCanvasElement {
  const size = radius * 2;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(radius, radius, 0, radius, radius, radius);
  g.addColorStop(0, "rgba(0,0,0,1)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return c;
}

export function createHeatmapOverlay(maps: any, points: HeatPoint[], options: HeatOptions = {}) {
  const radius = options.radius ?? 24;
  const opacity = options.opacity ?? 0.6;

  class HeatOverlay extends maps.OverlayView {
    private canvas: HTMLCanvasElement | null = null;
    private ramp = gradientRamp();
    private stamp = blobStamp(radius);
    /** True between the start of a gesture and the map settling. */
    private moving = false;
    private listeners: Array<{ remove: () => void }> = [];

    onAdd() {
      const canvas = document.createElement("canvas");
      canvas.style.position = "absolute";
      // The overlay must never eat a click meant for an incident marker.
      canvas.style.pointerEvents = "none";
      canvas.style.opacity = String(opacity);
      this.canvas = canvas;
      this.getPanes().overlayLayer.appendChild(canvas);

      // draw() is called on every frame of a pan or zoom, and its second pass
      // walks every pixel of the viewport in JavaScript — on a phone that is
      // roughly a million array writes per frame, which is what made the map
      // feel stuck. The overlay pane already translates with the map during a
      // drag, so the previous canvas stays aligned; repaint once the gesture
      // settles instead of fighting for every frame.
      const map = this.getMap();
      if (map) {
        this.listeners = [
          map.addListener("dragstart", () => {
            this.moving = true;
          }),
          map.addListener("zoom_changed", () => {
            this.moving = true;
          }),
          map.addListener("idle", () => {
            this.moving = false;
            this.draw();
          }),
        ];
      }
    }

    onRemove() {
      this.listeners.forEach((l) => l.remove());
      this.listeners = [];
      this.canvas?.remove();
      this.canvas = null;
    }

    draw() {
      if (this.moving) return;
      const canvas = this.canvas;
      const projection = this.getProjection();
      const map = this.getMap();
      if (!canvas || !projection || !map) return;

      const bounds = map.getBounds();
      if (!bounds) return;

      // Work in div-pixel space, the coordinate system the overlay pane uses.
      const sw = projection.fromLatLngToDivPixel(bounds.getSouthWest());
      const ne = projection.fromLatLngToDivPixel(bounds.getNorthEast());
      // Pad by one radius so a blob just off-screen still bleeds into view.
      const left = Math.min(sw.x, ne.x) - radius;
      const top = Math.min(sw.y, ne.y) - radius;
      const width = Math.ceil(Math.abs(ne.x - sw.x) + radius * 2);
      const height = Math.ceil(Math.abs(sw.y - ne.y) + radius * 2);
      if (width <= 0 || height <= 0) return;

      canvas.style.left = `${left}px`;
      canvas.style.top = `${top}px`;
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, width, height);

      let painted = 0;
      for (const p of points) {
        const px = projection.fromLatLngToDivPixel(new maps.LatLng(p.lat, p.lng));
        const x = px.x - left - radius;
        const y = px.y - top - radius;
        if (x < -radius * 2 || y < -radius * 2 || x > width || y > height) continue;
        // Alpha accumulates where blobs overlap — that accumulation is the density.
        ctx.globalAlpha = Math.min(Math.max(p.weight, 0.05), 1);
        ctx.drawImage(this.stamp, x, y);
        painted++;
      }
      ctx.globalAlpha = 1;
      if (painted === 0) return;

      const image = ctx.getImageData(0, 0, width, height);
      const data = image.data;
      for (let i = 0; i < data.length; i += 4) {
        const alpha = data[i + 3];
        if (alpha === 0) continue;
        const offset = alpha * 4;
        data[i] = this.ramp[offset];
        data[i + 1] = this.ramp[offset + 1];
        data[i + 2] = this.ramp[offset + 2];
      }
      ctx.putImageData(image, 0, 0);
    }
  }

  return new HeatOverlay();
}
