import { afterEach, describe, expect, it, vi } from "vitest";

import {
  compareVersions,
  DEPRECATION_MESSAGE,
  fetchPackageDocument,
  FROZEN_VERSION,
  parseVersion,
  STANDALONE_PACKAGE_NAME,
  versionsAbove,
  versionsWithoutMessage,
} from "./v2-package-deprecation";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("version comparison", () => {
  it("parses build and prerelease identifiers", () => {
    expect(parseVersion("5.1.2")).toEqual({ build: [5, 1, 2], prerelease: [] });
    expect(parseVersion("5.2.0-rc.1")).toEqual({ build: [5, 2, 0], prerelease: ["rc", 1] });
    expect(parseVersion("5.1.2+build.7")).toBeUndefined();
    expect(parseVersion("latest")).toBeUndefined();
  });

  it("orders releases, then prereleases below their release", () => {
    expect(compareVersions("5.1.10", "5.1.9")).toBeGreaterThan(0);
    expect(compareVersions("5.1.2", "5.1.2")).toBe(0);
    expect(compareVersions("5.2.0-rc.0", "5.1.9")).toBeGreaterThan(0);
    expect(compareVersions("5.2.0-rc.0", "5.2.0")).toBeLessThan(0);
    expect(compareVersions("5.2.0-rc.1", "5.2.0-rc.10")).toBeLessThan(0);
    expect(compareVersions("5.2.0-alpha", "5.2.0-1")).toBeGreaterThan(0);
    expect(compareVersions("5.2.0-rc.1", "5.2.0-rc.1.0")).toBeLessThan(0);
  });

  it("rejects a version it cannot parse", () => {
    expect(() => {
      compareVersions("5.1.2", "next");
    }).toThrow("Not a semantic version: next");
  });
});

describe("freeze check", () => {
  it("reports versions above the frozen ceiling", () => {
    const published = ["4.0.0", "5.1.2", "5.2.0", "5.10.0", "5.2.0-rc.0"];
    expect(versionsAbove(published, FROZEN_VERSION)).toEqual(["5.2.0-rc.0", "5.2.0", "5.10.0"]);
  });

  it("accepts a registry that holds nothing above the ceiling", () => {
    expect(versionsAbove(["5.1.2", "4.4.12-rc.0", "5.1.2"], FROZEN_VERSION)).toEqual([]);
  });
});

describe("deprecation coverage", () => {
  it("lists versions whose message differs from the canonical one", () => {
    const document = {
      versions: {
        "5.0.0": { deprecated: DEPRECATION_MESSAGE },
        "5.1.0": {},
        "5.1.1": { deprecated: "older wording" },
        "5.1.2": { deprecated: DEPRECATION_MESSAGE },
      },
    };
    expect(versionsWithoutMessage(document)).toEqual(["5.1.0", "5.1.1"]);
  });

  it("accepts a fully deprecated document", () => {
    const document = { versions: { "5.1.2": { deprecated: DEPRECATION_MESSAGE } } };
    expect(versionsWithoutMessage(document)).toEqual([]);
  });
});

describe("registry reader", () => {
  it("requests the abbreviated document with an encoded scope", async () => {
    const requests: { headers: Headers; url: string }[] = [];
    const fetchImpl = vi.fn((input: Request | string | URL, init?: RequestInit) => {
      requests.push(new Request(input, init));
      return Promise.resolve(Response.json({ versions: { "5.1.2": {} } }));
    });
    const document = await fetchPackageDocument(STANDALONE_PACKAGE_NAME, undefined, fetchImpl);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("https://registry.npmjs.org/@jerome-benoit%2Fsap-ai-provider-v2");
    expect(requests[0]?.headers.get("accept")).toBe("application/vnd.npm.install-v1+json");
    expect(Object.keys(document.versions)).toEqual(["5.1.2"]);
  });

  it("fails closed on a registry error answer", async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(new Response("gone", { status: 404 })));
    await expect(
      fetchPackageDocument(STANDALONE_PACKAGE_NAME, undefined, fetchImpl),
    ).rejects.toThrow("Registry answered 404");
  });

  it("fails closed on a document without versions", async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(Response.json({ name: STANDALONE_PACKAGE_NAME })),
    );
    await expect(
      fetchPackageDocument(STANDALONE_PACKAGE_NAME, undefined, fetchImpl),
    ).rejects.toThrow("has no versions");
  });
});
