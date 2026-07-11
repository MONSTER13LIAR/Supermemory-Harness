import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readSmartConfig, runSmart } from "../src/smart.js";

test("smart enable requires confirmation and does not copy key", async () => {
  const home = await mkdtemp(join(tmpdir(), "smctl-smart-home-"));
  const result = await runSmart({
    home,
    action: "enable",
    env: { OPENAI_API_KEY: "openai-test-secret-value-1234567890" }
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.status, "needs-confirmation");
  assert.doesNotMatch(result.text, /openai-test-secret/);
});

test("smart enable stores env reference with yes", async () => {
  const home = await mkdtemp(join(tmpdir(), "smctl-smart-home-"));
  const result = await runSmart({
    home,
    action: "enable",
    yes: true,
    env: { OPENAI_API_KEY: "openai-test-secret-value-1234567890" }
  });
  const config = await readSmartConfig(join(home, ".config", "smctl", "smart.json"));

  assert.equal(result.status, "enabled");
  assert.equal(config.apiKeyRef, "env:OPENAI_API_KEY");
  assert.doesNotMatch(JSON.stringify(config), /openai-test-secret/);
});

test("smart doctor fails when referenced env is missing", async () => {
  const home = await mkdtemp(join(tmpdir(), "smctl-smart-home-"));
  await runSmart({
    home,
    action: "enable",
    yes: true,
    env: { GEMINI_API_KEY: "gemini-secret" }
  });

  const result = await runSmart({ home, action: "doctor", env: {} });

  assert.equal(result.exitCode, 1);
  assert.match(result.text, /Referenced API key env is missing/);
  assert.doesNotMatch(result.text, /\[object Object\]/);
});

test("smart enable infers provider from a custom key env", async () => {
  const home = await mkdtemp(join(tmpdir(), "smctl-smart-home-"));
  const result = await runSmart({
    home,
    action: "enable",
    yes: true,
    apiKeyEnv: "CUSTOM_MODEL_KEY",
    env: { CUSTOM_MODEL_KEY: ["sk", "ant", "test-value"].join("-") }
  });
  const config = await readSmartConfig(join(home, ".config", "smctl", "smart.json"));

  assert.equal(result.status, "enabled");
  assert.equal(config.provider, "anthropic");
  assert.equal(config.apiKeyRef, "env:CUSTOM_MODEL_KEY");
});

test("smart enable infers provider from generic env names", async () => {
  const home = await mkdtemp(join(tmpdir(), "smctl-smart-home-"));
  const result = await runSmart({
    home,
    action: "enable",
    yes: true,
    env: { LLM_API_KEY: `AIza${"test-value"}` }
  });
  const config = await readSmartConfig(join(home, ".config", "smctl", "smart.json"));

  assert.equal(result.status, "enabled");
  assert.equal(config.provider, "gemini");
  assert.equal(config.apiKeyRef, "env:LLM_API_KEY");
});

test("smart enable asks for provider when custom key shape is unknown", async () => {
  const home = await mkdtemp(join(tmpdir(), "smctl-smart-home-"));
  const result = await runSmart({
    home,
    action: "enable",
    apiKeyEnv: "CUSTOM_MODEL_KEY",
    env: { CUSTOM_MODEL_KEY: "unknown-provider-secret" }
  });

  assert.equal(result.exitCode, 1);
  assert.match(result.text, /could not infer/);
  assert.match(result.text, /--provider/);
  assert.doesNotMatch(result.text, /unknown-provider-secret/);
});
