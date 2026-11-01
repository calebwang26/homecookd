import type { NextConfig } from "next";

// Static export (brief section 2). next/image goes through src/lib/imageLoader.ts, which maps
// /media/{stock,app-covers,app}/*.jpg|png to the pre-generated WebP widths in /media/_opt/.
const nextConfig: NextConfig = {
  output: "export",
  reactStrictMode: true,
  poweredByHeader: false,
  // Always a value, so a build without the switch compiles out the new api's upload code (web/src/lib/dish/api.ts).
  env: { NEXT_PUBLIC_DISH_UPLOADS: process.env.NEXT_PUBLIC_DISH_UPLOADS === 'links' ? 'links' : 'raw' },
  images: {
    loader: "custom",
    loaderFile: "./src/lib/imageLoader.ts",
    deviceSizes: [640, 960, 1280, 1920],
    imageSizes: [160, 320, 480],
    qualities: [78],
  },
};

export default nextConfig;
