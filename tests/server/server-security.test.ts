import { describe, expect, it } from "vitest";
import {
  extractBearerToken,
  isLoopbackHost,
  resolveAuthToken,
  resolveServeHost,
  resolveServeSecurity,
  tokensMatch,
} from "../../src/server/server-security.js";

describe("isLoopbackHost", () => {
  it("treats 127.0.0.1 / ::1 / localhost as loopback", () => {
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("::1")).toBe(true);
    expect(isLoopbackHost("[::1]")).toBe(true);
    expect(isLoopbackHost("localhost")).toBe(true);
    expect(isLoopbackHost("LOCALHOST")).toBe(true);
    expect(isLoopbackHost("  127.0.0.1  ")).toBe(true);
  });
  it("treats 0.0.0.0 and LAN/public hosts as non-loopback", () => {
    expect(isLoopbackHost("0.0.0.0")).toBe(false);
    expect(isLoopbackHost("192.168.1.10")).toBe(false);
    expect(isLoopbackHost("memoark.example.com")).toBe(false);
  });
});

describe("resolveServeHost", () => {
  it("defaults to loopback when nothing set", () => {
    expect(resolveServeHost({})).toBe("127.0.0.1");
    expect(resolveServeHost({ configHost: "  " })).toBe("127.0.0.1");
  });
  it("uses config host when present", () => {
    expect(resolveServeHost({ configHost: "0.0.0.0" })).toBe("0.0.0.0");
  });
  it("CLI flag overrides config", () => {
    expect(resolveServeHost({ flagHost: "192.168.1.5", configHost: "0.0.0.0" })).toBe(
      "192.168.1.5",
    );
  });
});

describe("resolveAuthToken", () => {
  it("returns undefined when unset", () => {
    expect(resolveAuthToken({})).toBeUndefined();
    expect(resolveAuthToken({ configToken: "  " })).toBeUndefined();
  });
  it("env overrides config", () => {
    expect(resolveAuthToken({ envToken: "envtok", configToken: "cfgtok" })).toBe("envtok");
    expect(resolveAuthToken({ configToken: "cfgtok" })).toBe("cfgtok");
  });
});

describe("resolveServeSecurity", () => {
  it("loopback default with no token → allowed, no auth", () => {
    const s = resolveServeSecurity({});
    expect(s.host).toBe("127.0.0.1");
    expect(s.authToken).toBeUndefined();
  });
  it("loopback with token → allowed, token enforced everywhere", () => {
    const s = resolveServeSecurity({ configToken: "secret" });
    expect(s.host).toBe("127.0.0.1");
    expect(s.authToken).toBe("secret");
  });
  it("non-loopback with no token → refuses to start with actionable message", () => {
    expect(() => resolveServeSecurity({ flagHost: "0.0.0.0" })).toThrow(
      /MEMOARK_AUTH_TOKEN|auth_token/,
    );
  });
  it("non-loopback with token → allowed", () => {
    const s = resolveServeSecurity({ flagHost: "0.0.0.0", envToken: "secret" });
    expect(s.host).toBe("0.0.0.0");
    expect(s.authToken).toBe("secret");
  });
});

describe("tokensMatch", () => {
  it("matches identical tokens", () => {
    expect(tokensMatch("secret-token", "secret-token")).toBe(true);
  });
  it("rejects wrong tokens", () => {
    expect(tokensMatch("secret-token", "wrong-token")).toBe(false);
  });
  it("rejects different-length tokens", () => {
    expect(tokensMatch("secret-token", "secret")).toBe(false);
  });
  it("rejects undefined", () => {
    expect(tokensMatch("secret-token", undefined)).toBe(false);
  });
});

describe("extractBearerToken", () => {
  it("extracts the token after 'Bearer '", () => {
    expect(
      extractBearerToken({ header: (n) => (n === "authorization" ? "Bearer abc123" : undefined) }),
    ).toBe("abc123");
  });
  it("returns undefined without a bearer header", () => {
    expect(extractBearerToken({ header: () => undefined })).toBeUndefined();
  });
});
