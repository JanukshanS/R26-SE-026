/** The Kaduna.lk logo (tow truck + gear + wordmark), the same artwork the mobile app uses.
 *  Plain <img>: the site is a static export, so next/image's optimizer isn't available. */
export function BrandLogo({ height = 40, className = "" }: { height?: number; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/images/logo.png"
      alt="Kaduna.lk"
      width={Math.round((height * 447) / 315)}
      height={height}
      className={`brand-logo w-auto object-contain ${className}`}
      style={{ height }}
    />
  );
}
