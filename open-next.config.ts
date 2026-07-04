import { defineCloudflareConfig } from "@opennextjs/cloudflare";
// R2 incremental cache DEFERRED (Phase 5, 2026-07-03) — see wrangler.jsonc note.
// Re-add before any ISR/`revalidate` route ships:
//   import r2IncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/r2-incremental-cache";
//   export default defineCloudflareConfig({ incrementalCache: r2IncrementalCache });
export default defineCloudflareConfig({});
