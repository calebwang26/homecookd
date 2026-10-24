// next/image through the static-export loader (brief 5 "Img"). Server-safe.
//
//   <Img src={PHOTOS.handsKneading.src} alt={PHOTOS.handsKneading.alt} fill sizes="(min-width: 1024px) 18vw, 30vw" />
//   <Img src={recipe.image} alt="" width={640} height={640} sizes="16vw" />
//   <Img src={PHOTOS.youngAdultNight.src} alt="" fill blurred />          // the pre-blurred 96px layer (a6)
//
// /media/{stock,app-covers,app}/*.jpg|png resolve to /media/_opt/<dir>/<name>-<w>.webp. With `fill`,
// the parent must be position: relative (or absolute) and sized. Pass `sizes` for anything that
// isn't full-width, or the browser fetches 1920w.
import Image, { type ImageProps } from 'next/image';
import { blurSrc } from '@/lib/imageLoader';
import { imageSize } from '@/content/media';

export type ImgProps = Omit<ImageProps, 'src'> & {
  src: string;
  /** use the pre-blurred 96px WebP (photo-*.jpg only) */
  blurred?: boolean;
  /** object-position shortcut (e.g. PHOTOS.x.focus) */
  focus?: string;
};

export function Img({ src, blurred, focus, style, alt, fill, width, height, ...rest }: ImgProps) {
  const s = { objectFit: 'cover' as const, ...(focus ? { objectPosition: focus } : {}), ...style };
  if (blurred) {
    const b = blurSrc(src);
    if (b) {
      return <Image src={b} alt={alt} fill={fill} width={fill ? undefined : (width ?? 96)} height={fill ? undefined : (height ?? 96)} unoptimized style={s} {...rest} />;
    }
  }
  const dims = fill ? {} : { width: width ?? imageSize(src).width, height: height ?? imageSize(src).height };
  return <Image src={src} alt={alt} fill={fill} {...dims} style={s} {...rest} />;
}
