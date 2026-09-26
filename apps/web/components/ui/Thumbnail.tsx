import OptimizedImage from "./OptimizedImage";

type ThumbnailProps = {
  src?: string | null;
  alt: string;
  /** Rendered edge length in CSS pixels; the optimizer serves 1x/2x of it. */
  size: number;
  className?: string;
};

/** Small square product image (cart, orders…): optimized, lazy, with a placeholder. */
export default function Thumbnail({ src, alt, size, className = "" }: ThumbnailProps) {
  if (!src) {
    return <div aria-hidden="true" className={`shrink-0 bg-gray-100 ${className}`} />;
  }
  return (
    <OptimizedImage
      src={src}
      alt={alt}
      width={size}
      height={size}
      sizes={`${size}px`}
      loading="lazy"
      className={`shrink-0 bg-gray-100 object-cover ${className}`}
    />
  );
}
