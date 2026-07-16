import test from "node:test";
import assert from "node:assert/strict";
import { bannerLines, cliBanner } from "../src/banner.js";

test("banner keeps the original plain silhouette", () => {
  const banner = cliBanner("running", { color: false });

  assert.match(banner, /___ _ __ ___/);
  assert.match(banner, /Supermemory Harness\n running/);
  assert.deepEqual(banner.split("\n"), bannerLines("running"));
});

test("banner can render blue Supermemory-style terminal texture", () => {
  const banner = cliBanner("install", { color: true });

  assert.match(banner, /\x1b\[38;5;27m/);
  assert.match(banner, /\x1b\[38;5;45m/);
  assert.match(banner, /\x1b\[1m/);
  assert.match(banner, /Supermemory Harness/);
  assert.match(banner, /install/);
});
