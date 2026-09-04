import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Vercel's build plugin currently fails ("Cannot patch preview comments when
  // immutable static file upload is enabled") when this is on with our Next
  // version, so opt out until that platform-side incompatibility is fixed.
  supportsImmutableAssets: false,
};

export default nextConfig;
