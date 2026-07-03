import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;

// Enables the OpenNext Cloudflare bindings during `next dev`.
initOpenNextCloudflareForDev();
