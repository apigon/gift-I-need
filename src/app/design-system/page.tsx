import { notFound } from "next/navigation";

import {
  Alert,
  Button,
  Heading,
  Input,
  Link,
  StatusBadge,
  Text,
} from "@/components";

import { ComboboxDemo, ControlledFieldDemo, ToastDemo } from "./components";

// Dev-only reference: exercises every token and primitive state so it can be
// checked against `context/changes/design-system-baseline/palette-proof.html`.
// 404s in production so nothing is exposed; see src/lib/auth/routes.ts for the
// dev-only allowlist entry.

const SWATCHES: Array<{ name: string; hex: string; role: string; className: string }> = [
  { name: "canvas", hex: "#FFF5F5", role: "page background", className: "bg-canvas" },
  { name: "surface", hex: "#FFFFFF", role: "cards, inputs, toasts", className: "bg-surface" },
  { name: "surface-tint", hex: "#F7D6D0", role: "subtle fills, info alert", className: "bg-surface-tint" },
  { name: "fg", hex: "#4A4A4A", role: "body text", className: "bg-fg" },
  { name: "fg-muted", hex: "#6B6B6B", role: "secondary text (canvas/surface only)", className: "bg-fg-muted" },
  { name: "edge", hex: "#9C7D84", role: "UI boundaries", className: "bg-edge" },
  { name: "hairline", hex: "#EFD9DA", role: "decorative dividers only", className: "bg-hairline" },
  { name: "brand-rose", hex: "#E2B4BD", role: "decorative accent only, never a control fill", className: "bg-brand-rose" },
  { name: "primary", hex: "#7B5EA7", role: "primary button fill", className: "bg-primary" },
  { name: "primary-hover", hex: "#6D4C9F", role: "primary hover", className: "bg-primary-hover" },
  { name: "on-primary", hex: "#FFFFFF", role: "label on primary", className: "bg-on-primary" },
  { name: "accent", hex: "#6D4C9F", role: "links, focus ring", className: "bg-accent" },
  { name: "danger", hex: "#A33A3A", role: "errors", className: "bg-danger" },
  { name: "danger-surface", hex: "#FBE4E1", role: "error surface", className: "bg-danger-surface" },
  { name: "success", hex: "#2F6B4F", role: "success", className: "bg-success" },
  { name: "success-surface", hex: "#DDEEDD", role: "success surface", className: "bg-success-surface" },
  { name: "status-available", hex: "#2F5D3A", role: "status: available", className: "bg-status-available" },
  { name: "status-available-surface", hex: "#DDEEDD", role: "status: available surface", className: "bg-status-available-surface" },
  { name: "status-taken", hex: "#5A5A5A", role: "status: taken", className: "bg-status-taken" },
  { name: "status-taken-surface", hex: "#ECE6E6", role: "status: taken surface", className: "bg-status-taken-surface" },
  { name: "status-mine", hex: "#5B3F8C", role: "status: mine", className: "bg-status-mine" },
  { name: "status-mine-surface", hex: "#ECE4F7", role: "status: mine surface", className: "bg-status-mine-surface" },
  { name: "status-given", hex: "#7A5A1E", role: "status: given", className: "bg-status-given" },
  { name: "status-given-surface", hex: "#FBEBC8", role: "status: given surface", className: "bg-status-given-surface" },
];

export default function DesignSystemPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-12 px-6 py-16">
      <div>
        <Heading level={1} size="display">
          Design system
        </Heading>
        <Text tone="muted">
          Dev-only reference. Compare against{" "}
          <code>palette-proof.html</code>.
        </Text>
      </div>

      <section className="flex flex-col gap-4">
        <Heading level={2}>Colour tokens</Heading>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {SWATCHES.map((swatch) => (
            <div key={swatch.name} className="flex flex-col gap-2 rounded-control border border-hairline p-3">
              <div className={`h-12 rounded-control border border-hairline ${swatch.className}`} />
              <Text variant="small" className="font-bold">
                {swatch.name}
              </Text>
              <Text variant="caption" tone="muted">
                {swatch.hex}
              </Text>
              <Text variant="small" tone="muted">
                {swatch.role}
              </Text>
            </div>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <Heading level={2}>Type scale</Heading>
        <div className="flex flex-col gap-3">
          <Heading level={1} size="display">
            Display — Gifts they actually want
          </Heading>
          <Heading level={1}>Title — Maja&apos;s 30th birthday</Heading>
          <Heading level={2}>Heading — Ceramic pour-over coffee set</Heading>
          <Text variant="body">
            Body — Pick something from the list and claim it. Other guests
            will see it as taken right away.
          </Text>
          <Text variant="small">Small — Around 120–160 zł · Link from Maja</Text>
          <Text variant="caption">Caption — Shared list · 6 ideas</Text>
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <Heading level={2}>Button</Heading>
        <div className="flex flex-wrap gap-3">
          <Button variant="primary">Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="primary" disabled>
            Disabled
          </Button>
          <Button variant="primary" pending pendingLabel="Claiming…">
            Claim this gift
          </Button>
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <Heading level={2}>Link</Heading>
        <Link href="/">Back to home</Link>
      </section>

      <section className="flex flex-col gap-4">
        <Heading level={2}>Input</Heading>
        <div className="flex flex-col gap-6 sm:flex-row">
          <Input id="ds-default" label="Default" placeholder="you@example.com" />
          <Input
            id="ds-hint"
            label="With hint"
            hint="We'll only use this to send you updates."
          />
          <Input
            id="ds-error"
            label="With error"
            error="Enter a valid email address."
          />
        </div>
        <ControlledFieldDemo />
      </section>

      <section className="flex flex-col gap-4">
        <Heading level={2}>Combobox</Heading>
        <ComboboxDemo />
      </section>

      <section className="flex flex-col gap-4">
        <Heading level={2}>Status badge</Heading>
        <div className="flex flex-wrap gap-3">
          <StatusBadge status="available" />
          <StatusBadge status="taken" />
          <StatusBadge status="mine" />
          <StatusBadge status="given" />
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <Heading level={2}>Alert</Heading>
        <div className="flex flex-col gap-3">
          <Alert tone="danger">That confirmation link didn&apos;t work.</Alert>
          <Alert tone="success">Your account is ready.</Alert>
          <Alert tone="info">
            <strong>Sign in to claim.</strong> Browsing doesn&apos;t need an
            account.
          </Alert>
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <Heading level={2}>Toast</Heading>
        <ToastDemo />
      </section>

      <section className="flex flex-col gap-4">
        <Heading level={2}>Reset keywords</Heading>
        <div className="h-12 w-24 rounded-control border border-hairline bg-transparent" />
        <Text variant="small" tone="muted">
          bg-transparent still resolves after the palette reset.
        </Text>
      </section>
    </main>
  );
}
