import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./passwords.js";

describe("password hashing (scrypt)", () => {
  it("returns salt:hash format and verifies correctly", () => {
    const stored = hashPassword("correct horse battery staple");
    expect(stored).toContain(":");
    expect(stored.split(":")[0].length).toBe(32); // 16-byte salt hex
    expect(verifyPassword("correct horse battery staple", stored)).toBe(true);
  });

  it("rejects a wrong password", () => {
    const stored = hashPassword("right-password");
    expect(verifyPassword("wrong-password", stored)).toBe(false);
  });

  it("produces a different hash each time (fresh salt)", () => {
    const a = hashPassword("same-password");
    const b = hashPassword("same-password");
    expect(a).not.toBe(b);
    expect(verifyPassword("same-password", a)).toBe(true);
    expect(verifyPassword("same-password", b)).toBe(true);
  });

  it("never verifies a malformed stored value", () => {
    expect(verifyPassword("anything", "")).toBe(false);
    expect(verifyPassword("anything", "only-salt")).toBe(false);
    expect(verifyPassword("anything", "salt:not-a-valid-hex")).toBe(false);
  });
});