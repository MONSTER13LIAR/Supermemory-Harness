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

test("banner colors by default unless disabled", () => {
  const oldTerm = process.env.TERM;
  const oldNoColor = process.env.NO_COLOR;
  process.env.TERM = "xterm-256color";
  delete process.env.NO_COLOR;
  try {
    assert.match(cliBanner("install"), /\x1b\[38;5;/);
  } finally {
    if (oldTerm === undefined) delete process.env.TERM;
    else process.env.TERM = oldTerm;
    if (oldNoColor === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = oldNoColor;
  }
});
