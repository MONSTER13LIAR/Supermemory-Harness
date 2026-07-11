import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
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

test("smart ping calls configured provider without exposing the key", async () => {
  const home = await mkdtemp(join(tmpdir(), "smctl-smart-home-"));
  await runSmart({
    home,
    action: "enable",
    yes: true,
    env: { OPENAI_API_KEY: "openai-test-secret-value-1234567890" }
  });
  const calls = [];
  const result = await runSmart({
    home,
    action: "ping",
    env: { OPENAI_API_KEY: "openai-test-secret-value-1234567890" },
    fetch: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ output_text: "smctl-ok" }), { status: 200 });
    }
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.status, "ok");
  assert.match(result.text, /smctl-ok/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.openai.com/v1/responses");
  assert.doesNotMatch(result.text, /openai-test-secret/);
});

test("smart ping fails when configured env is missing", async () => {
  const home = await mkdtemp(join(tmpdir(), "smctl-smart-home-"));
  await runSmart({
    home,
    action: "enable",
    yes: true,
    env: { GEMINI_API_KEY: "gemini-secret" }
  });
  const result = await runSmart({ home, action: "ping", env: {} });

  assert.equal(result.exitCode, 1);
  assert.match(result.text, /Referenced API key env is missing/);
});

test("smart ping sanitizes provider errors", async () => {
  const home = await mkdtemp(join(tmpdir(), "smctl-smart-home-"));
  const key = ["sk", "test-secret-value-1234567890"].join("-");
  await runSmart({
    home,
    action: "enable",
    yes: true,
    env: { OPENAI_API_KEY: key }
  });
  const result = await runSmart({
    home,
    action: "ping",
    env: { OPENAI_API_KEY: key },
    fetch: async () => new Response(JSON.stringify({
      error: { message: `bad key ${key}` }
    }), { status: 401, statusText: "Unauthorized" })
  });

  assert.equal(result.exitCode, 1);
  assert.match(result.text, /401 Unauthorized/);
  assert.doesNotMatch(result.text, /test-secret-value/);
  assert.match(result.text, /\[redacted-key\]/);
});

test("smart enable prompt stores a private file key reference", async () => {
  const home = await mkdtemp(join(tmpdir(), "smctl-smart-home-"));
  const key = ["sk", "prompt-secret-value-1234567890"].join("-");
  const detectedProviders = [];
  const result = await runSmart({
    home,
    action: "enable",
    prompt: true,
    env: {},
    promptApiKey: async () => key,
    onProviderDetected: async (provider) => detectedProviders.push(provider)
  });
  const configPath = join(home, ".config", "smctl", "smart.json");
  const keyPath = join(home, ".config", "smctl", "smart.key");
  const config = await readSmartConfig(configPath);
  const storedKey = await readFile(keyPath, "utf8");
  const keyMode = (await stat(keyPath)).mode & 0o777;

  assert.equal(result.status, "enabled");
  assert.equal(config.provider, "openai");
  assert.deepEqual(detectedProviders, ["openai"]);
  assert.equal(config.apiKeyRef, `file:${keyPath}`);
  assert.equal(storedKey.trim(), key);
  assert.equal(keyMode, 0o600);
  assert.doesNotMatch(JSON.stringify(config), /prompt-secret-value/);
  assert.doesNotMatch(result.text, /prompt-secret-value/);
});

test("smart enable prompt lets user choose provider for unknown key shape", async () => {
  const home = await mkdtemp(join(tmpdir(), "smctl-smart-home-"));
  const result = await runSmart({
    home,
    action: "enable",
    prompt: true,
    env: {},
    promptApiKey: async () => "provider-key-without-known-prefix",
    chooseProvider: async () => "anthropic"
  });
  const config = await readSmartConfig(join(home, ".config", "smctl", "smart.json"));

  assert.equal(result.status, "enabled");
  assert.equal(config.provider, "anthropic");
  assert.doesNotMatch(result.text, /provider-key-without-known-prefix/);
});

test("smart ping uses prompted file key reference", async () => {
  const home = await mkdtemp(join(tmpdir(), "smctl-smart-home-"));
  await runSmart({
    home,
    action: "enable",
    prompt: true,
    env: {},
    promptApiKey: async () => ["sk", "prompt-secret-value-1234567890"].join("-")
  });
  const result = await runSmart({
    home,
    action: "ping",
    env: {},
    fetch: async () => new Response(JSON.stringify({ output_text: "smctl-ok" }), { status: 200 })
  });

  assert.equal(result.exitCode, 0);
  assert.match(result.text, /smctl-ok/);
  assert.doesNotMatch(result.text, /prompt-secret-value/);
});

test("smart disable removes prompted key file", async () => {
  const home = await mkdtemp(join(tmpdir(), "smctl-smart-home-"));
  const keyPath = join(home, ".config", "smctl", "smart.key");
  await runSmart({
    home,
    action: "enable",
    prompt: true,
    env: {},
    promptApiKey: async () => ["sk", "prompt-secret-value-1234567890"].join("-")
  });

  await runSmart({ home, action: "disable" });

  await assert.rejects(readFile(keyPath, "utf8"));
});
