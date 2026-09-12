import { describe, expect, it } from "vitest";

import { AddItemSchema, CreateEventSchema } from "./schemas";

describe("CreateEventSchema", () => {
  it("accepts a name at the 120-character boundary", () => {
    const result = CreateEventSchema.safeParse({
      name: "a".repeat(120),
      eventDate: "2026-12-24",
      timezone: "Europe/Warsaw",
    });

    expect(result.success).toBe(true);
  });

  it("rejects a name over 120 characters", () => {
    const result = CreateEventSchema.safeParse({
      name: "a".repeat(121),
      eventDate: "2026-12-24",
      timezone: "Europe/Warsaw",
    });

    expect(result.success).toBe(false);
  });

  it("rejects an empty name", () => {
    const result = CreateEventSchema.safeParse({
      name: "   ",
      eventDate: "2026-12-24",
      timezone: "Europe/Warsaw",
    });

    expect(result.success).toBe(false);
  });

  it("rejects an empty date", () => {
    const result = CreateEventSchema.safeParse({
      name: "Birthday",
      eventDate: "",
      timezone: "Europe/Warsaw",
    });

    expect(result.success).toBe(false);
  });

  it("rejects an empty timezone", () => {
    const result = CreateEventSchema.safeParse({
      name: "Birthday",
      eventDate: "2026-12-24",
      timezone: "",
    });

    expect(result.success).toBe(false);
  });
});

describe("AddItemSchema", () => {
  it("accepts a title-only submission with empty optional fields", () => {
    const result = AddItemSchema.safeParse({
      title: "Ceramic mug",
      notes: "",
      link: "",
      priceRange: "",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.notes).toBeUndefined();
      expect(result.data.link).toBeUndefined();
      expect(result.data.priceRange).toBeUndefined();
    }
  });

  it("accepts a title at the 200-character boundary", () => {
    const result = AddItemSchema.safeParse({ title: "a".repeat(200) });

    expect(result.success).toBe(true);
  });

  it("rejects a title over 200 characters", () => {
    const result = AddItemSchema.safeParse({ title: "a".repeat(201) });

    expect(result.success).toBe(false);
  });

  it("rejects an empty title", () => {
    const result = AddItemSchema.safeParse({ title: "   " });

    expect(result.success).toBe(false);
  });

  it("rejects notes over 2000 characters", () => {
    const result = AddItemSchema.safeParse({
      title: "Gift",
      notes: "a".repeat(2001),
    });

    expect(result.success).toBe(false);
  });

  it("rejects a javascript: link", () => {
    const result = AddItemSchema.safeParse({
      title: "Gift",
      link: "javascript:alert(1)",
    });

    expect(result.success).toBe(false);
  });

  it("accepts an https:// link", () => {
    const result = AddItemSchema.safeParse({
      title: "Gift",
      link: "https://example.com/gift",
    });

    expect(result.success).toBe(true);
  });

  it("rejects a price range over 50 characters", () => {
    const result = AddItemSchema.safeParse({
      title: "Gift",
      priceRange: "a".repeat(51),
    });

    expect(result.success).toBe(false);
  });
});
