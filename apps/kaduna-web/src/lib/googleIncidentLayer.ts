/**
 * Incident markers as a single canvas rather than one map object each.
 *
 * 500 `google.maps.Marker`s is 500 things for the browser to lay out and
 * composite on every frame of a pan, and asking for `optimized` rendering did
 * not rescue it on a phone. One canvas draws the same picture in a few hundred
 * circle fills, which is sub-millisecond, so the map moves with the finger.
 *
 * Unlike the heatmap overlay this does no per-pixel work: there is no
 * `getImageData` pass, so it can safely repaint on every frame instead of
 * waiting for the map to settle.
 *
 * The canvas never takes pointer events — that would swallow drags. Clicks are
 * handled by the map and resolved here with `hitTest`, nearest-centre-wins
 * within the drawn radius.
 */

export interface CanvasIncident {
  id: string;
  lat: number;
  lng: number;
  impactScore: number;
  priority: string;
  live?: boolean;
}

/** Same formula both engines used for marker radius, so the legend's
 *  "size = impact" still reads true. */
export function radiusFor(inc: CanvasIncident): number {
  return (inc.live ? 7 : 4) + inc.impactScore * 0.5;
}

export function createIncidentOverlay<T extends CanvasIncident>(
  maps: any,
  incidents: T[],
  colours: Record<string, string>
) {
  class IncidentOverlay extends maps.OverlayView {
    private canvas: HTMLCanvasElement | null = null;
    /** Screen positions from the last paint, reused for hit testing. */
    private placed: Array<{ inc: T; x: number; y: number; r: number }> = [];
    private origin = { left: 0, top: 0 };

    onAdd() {
      const canvas = document.createElement("canvas");
      canvas.style.position = "absolute";
      canvas.style.pointerEvents = "none";
      this.canvas = canvas;
      this.getPanes().overlayMouseTarget.appendChild(canvas);
    }

    onRemove() {
      this.canvas?.remove();
      this.canvas = null;
      this.placed = [];
    }

    draw() {
      const canvas = this.canvas;
      const projection = this.getProjection();
      const map = this.getMap();
      if (!canvas || !projection || !map) return;

      const bounds = map.getBounds();
      if (!bounds) return;

      const sw = projection.fromLatLngToDivPixel(bounds.getSouthWest());
      const ne = projection.fromLatLngToDivPixel(bounds.getNorthEast());
      const pad = 40; // widest marker, so one just off-screen still paints
      const left = Math.min(sw.x, ne.x) - pad;
      const top = Math.min(sw.y, ne.y) - pad;
      const width = Math.ceil(Math.abs(ne.x - sw.x) + pad * 2);
      const height = Math.ceil(Math.abs(sw.y - ne.y) + pad * 2);
      if (width <= 0 || height <= 0) return;

      canvas.style.left = `${left}px`;
      canvas.style.top = `${top}px`;
      // Assigning width/height also clears the canvas, so only pay for it when
      // the viewport actually changed size.
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      this.origin = { left, top };

      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, width, height);

      this.placed = [];
      for (const inc of incidents) {
        const px = projection.fromLatLngToDivPixel(new maps.LatLng(inc.lat, inc.lng));
        const x = px.x - left;
        const y = px.y - top;
        const r = radiusFor(inc);
        if (x < -r || y < -r || x > width + r || y > height + r) continue;

        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = colours[inc.priority] ?? "#888";
        ctx.globalAlpha = inc.live ? 0.95 : 0.8;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.lineWidth = inc.live ? 3 : 1;
        ctx.strokeStyle = inc.live ? "#111827" : "rgba(0,0,0,0.28)";
        ctx.stroke();

        this.placed.push({ inc, x, y, r });
      }
    }

    /** Nearest incident under a click, or null. Smallest marker wins a tie so
     *  a low-impact dot drawn on top of a big one is still reachable. */
    hitTest(latLng: any): T | null {
      const projection = this.getProjection();
      if (!projection || this.placed.length === 0) return null;
      const px = projection.fromLatLngToDivPixel(latLng);
      const x = px.x - this.origin.left;
      const y = px.y - this.origin.top;

      let best: { inc: T; r: number } | null = null;
      for (const p of this.placed) {
        const d = Math.hypot(p.x - x, p.y - y);
        if (d <= p.r + 2 && (best === null || p.r < best.r)) best = { inc: p.inc, r: p.r };
      }
      return best?.inc ?? null;
    }
  }

  return new IncidentOverlay();
}
