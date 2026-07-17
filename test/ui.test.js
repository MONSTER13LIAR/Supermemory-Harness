import test from "node:test";
import assert from "node:assert/strict";
import { injectHarnessBar } from "../src/ui.js";

test("injectHarnessBar adds the Harness Bar before the dashboard body closes", () => {
  const html = "<!doctype html><html><body><main>supermemory local</main></body></html>";
  const injected = injectHarnessBar(html);

  assert.match(injected, /supermemory local/);
  assert.match(injected, /id="smctl-harness-bar"/);
  assert.match(injected, /id="smctl-harness-panel"/);
  assert.match(injected, /data-smctl-harness-bar/);
  assert.match(injected, /fetch\("\/__smctl\/bar"/);
  assert.match(injected, /fetch\("\/__smctl\/panel"/);
  assert.match(injected, /Trust/);
  assert.match(injected, /Genome/);
  assert.match(injected, /Memory Genome/);
  assert.match(injected, /Trust score/);
  assert.match(injected, /Readiness/);
  assert.match(injected, /smctl-meter/);
  assert.match(injected, /data-copy/);
  assert.match(injected, /smctl trust --probe/);
  assert.match(injected, /\/__smctl\/setup\/apply/);
  assert.match(injected, /\/__smctl\/genome\/apply/);
  assert.match(injected, /\/__smctl\/verify/);
  assert.ok(injected.indexOf("smctl-harness-bar") < injected.indexOf("</body>"));
});

test("injectHarnessBar is idempotent", () => {
  const html = injectHarnessBar("<html><body>supermemory</body></html>");
  assert.equal(injectHarnessBar(html), html);
});
