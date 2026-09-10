import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Off-system class guard: after globals.css resets Tailwind's default
// color/font-size/radius namespaces, an off-system class like `text-red-600`
// generates no CSS and Tailwind gives no warning — see CLAUDE.md "Design system".
const OFF_SYSTEM =
  "/(^|\\s)([a-z-]+:)*(bg|text|border|ring|outline|fill|stroke|divide|placeholder|decoration|accent|caret|shadow|from|via|to)-(red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone|black|white)(-\\d{2,3})?(\\/\\d+)?(\\s|$)|(^|\\s)([a-z-]+:)*text-(xs|sm|base|lg|[2-9]?xl)(\\/\\S+)?(\\s|$)|(^|\\s)([a-z-]+:)*rounded(-[trblse]{1,2})?-(xs|sm|md|lg|[2-4]?xl)(\\s|$)|-\\[#|(^|\\s)dark:/";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: `Literal[value=${OFF_SYSTEM}]`,
          message:
            "Off-system class detected. Use GIN's semantic tokens — see the \"Design system\" section in CLAUDE.md.",
        },
        {
          selector: `TemplateElement[value.raw=${OFF_SYSTEM}]`,
          message:
            "Off-system class detected. Use GIN's semantic tokens — see the \"Design system\" section in CLAUDE.md.",
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated artifacts (gitignored, never hand-edited):
    ".open-next/**", // OpenNext Cloudflare build output
    ".wrangler/**", // wrangler dev/preview local state (appears after `pnpm preview`)
    "cloudflare-env.d.ts", // `wrangler types` / `pnpm cf-typegen` output
  ]),
]);

export default eslintConfig;
