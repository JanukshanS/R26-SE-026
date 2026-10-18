/** Minimal toast — the claim flow has no toast component, and a few transient
 * messages don't justify a dependency. Uses textContent, never innerHTML. */
export function showToast(message: string, durationMs = 3500): void {
  if (typeof document === "undefined") return;
  const el = document.createElement("div");
  el.setAttribute("role", "status");
  el.textContent = message;
  Object.assign(el.style, {
    position: "fixed",
    left: "50%",
    bottom: "24px",
    transform: "translateX(-50%)",
    maxWidth: "calc(100% - 32px)",
    padding: "10px 16px",
    borderRadius: "8px",
    background: "rgba(17, 17, 17, 0.9)",
    color: "#fff",
    fontSize: "14px",
    lineHeight: "1.4",
    textAlign: "center",
    zIndex: "9999",
    pointerEvents: "none",
  });
  document.body.appendChild(el);
  setTimeout(() => el.remove(), durationMs);
}
