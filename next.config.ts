import type { NextConfig } from "next";
import { initializeOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;

// Enables the OpenNext Cloudflare bindings during `next dev`.
initializeOpenNextCloudflareForDev();
