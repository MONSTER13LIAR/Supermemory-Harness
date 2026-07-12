import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Readable } from "node:stream";
import { hardwareInit, runHardware } from "../src/hardware.js";

test("hardware init stores a device profile", async () => {
  const home = await mkdtemp(join(tmpdir(), "smctl-hardware-home-"));
  const result = await hardwareInit({
    home,
    name: "Robot Arm V1",
    project: "arm-lab"
  });
  const profile = JSON.parse(await readFile(join(home, ".config", "smctl", "hardware", "active.json"), "utf8"));

  assert.equal(result.exitCode, 0);
  assert.equal(profile.hardwareTag, "hardware:robot-arm-v1");
  assert.equal(profile.projectTag, "project:arm-lab");
  assert.match(result.text, /hardware init/);
});

test("hardware ingest summarizes logs and writes tagged memory", async () => {
  const home = await mkdtemp(join(tmpdir(), "smctl-hardware-home-"));
  await hardwareInit({ home, name: "Robot Arm V1" });
  const logPath = join(home, "run.log");
  await writeFile(logPath, [
    "servo3 ready",
    "WARN servo3 drift 4deg",
    "ERROR servo3 overheat after 11 minutes",
    "calibrated offset -2deg ok"
  ].join("\n"));

  const writes = [];
  const result = await runHardware({
    action: "ingest",
    home,
    from: logPath,
    session: "grasp-test",
    fetch: fakeFetch({ writes })
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.eventCount, 4);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].containerTag, "hardware:robot-arm-v1");
  assert.deepEqual(writes[0].containerTags, ["hardware:robot-arm-v1", "session:grasp-test"]);
  assert.match(writes[0].content, /servo3 overheat/);
  assert.match(result.text, /hardware experience captured/);
});

test("hardware observe reads stdin stream", async () => {
  const home = await mkdtemp(join(tmpdir(), "smctl-hardware-home-"));
  await hardwareInit({ home, name: "Arm" });
  const writes = [];
  const result = await runHardware({
    action: "observe",
    home,
    stdin: Readable.from(["ready\nERROR joint stall\n"]),
    fetch: fakeFetch({ writes })
  });

  assert.equal(result.exitCode, 0);
  assert.equal(writes.length, 1);
  assert.match(result.text, /Events: 2/);
});

test("hardware observe fails clearly without stdin data", async () => {
  const result = await runHardware({
    action: "observe",
    stdin: null,
    fetch: fakeFetch()
  });

  assert.equal(result.exitCode, 1);
  assert.match(result.text, /No stdin log data received/);
});

test("hardware coach and replay inspect hardware-tagged memories", async () => {
  const home = await mkdtemp(join(tmpdir(), "smctl-hardware-home-"));
  await hardwareInit({ home, name: "Robot Arm V1" });

  const coach = await runHardware({
    action: "coach",
    home,
    fetch: fakeFetch()
  });
  const replay = await runHardware({
    action: "replay",
    home,
    fetch: fakeFetch()
  });

  assert.equal(coach.exitCode, 0);
  assert.match(coach.text, /Hardware memory sample/);
  assert.match(coach.text, /session:grasp-test/);
  assert.equal(replay.exitCode, 0);
  assert.match(replay.text, /Recent hardware memories/);
});

function fakeFetch(options = {}) {
  const writes = options.writes ?? [];
  return async (url, init) => {
    if (url === "http://localhost:11434/api/generate") {
      return response(500, { error: "ollama unavailable" });
    }
    if (url.endsWith("/v3/documents") && init?.method === "POST") {
      writes.push(JSON.parse(init.body));
      return response(200, { id: "doc_hw", status: "queued" });
    }
    if (url.endsWith("/v3/documents/list")) {
      return response(200, {
        memories: [
          {
            id: "doc_hw",
            status: "done",
            title: "Hardware memory for robot arm",
            containerTags: ["hardware:robot-arm-v1", "session:grasp-test"]
          },
          {
            id: "doc_other",
            status: "done",
            title: "Other memory",
            containerTags: ["project:other"]
          }
        ]
      });
    }
    return response(404, { error: "missing" });
  };
}

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(body);
    }
  };
}
