import assert from "node:assert/strict";
import test from "node:test";
import { checkForUpdate, isNewerRelease, type UpdateOperations } from "../src/adapters/update.ts";

function fixture(overrides: Partial<UpdateOperations> = {}) {
  const calls: string[] = [];
  const ops: UpdateOperations = {
    installation: async () => ({ version: "0.3.0", prefix: "/npm" }),
    latest: async () => { calls.push("check"); return "0.4.0"; },
    lock: async () => { calls.push("lock"); return async () => { calls.push("release"); }; },
    install: async (version, prefix) => { calls.push(`install ${version} ${prefix}`); },
    ...overrides,
  };
  return { calls, ops };
}

test("compares stable versions numerically without downgrades or prereleases", () => {
  for (const next of ["0.3.1", "0.10.0", "1.0.0"]) assert.equal(isNewerRelease(next, "0.3.0"), true);
  for (const next of ["0.3.0", "0.2.9", "0.4.0-beta.1", "latest", "1.0.0;echo bad", "01.0.0"])
    assert.equal(isNewerRelease(next, "0.3.0"), false);
  assert.equal(isNewerRelease("1.0.0", "0.4.0-dev"), false);
});

test("reports ready only after successful installation and releases lock", async () => {
  const { calls, ops } = fixture();
  assert.equal(await checkForUpdate(ops), "0.4.0");
  assert.deepEqual(calls, ["lock", "check", "install 0.4.0 /npm", "release"]);
});

test("skips unsupported installations and concurrent updates", async () => {
  const unsupported = fixture({ installation: async () => null });
  assert.equal(await checkForUpdate(unsupported.ops), null);
  assert.deepEqual(unsupported.calls, []);
  const locked = fixture({ lock: async () => null });
  assert.equal(await checkForUpdate(locked.ops), null);
  assert.deepEqual(locked.calls, []);
});

test("does not install an equal or older version", async () => {
  for (const version of ["0.3.0", "0.2.0", "0.4.0-beta.1"]) {
    const { calls, ops } = fixture({ latest: async () => version });
    assert.equal(await checkForUpdate(ops), null);
    assert.deepEqual(calls, ["lock", "release"]);
  }
});

test("registry and install errors stay silent and release the lock", async () => {
  for (const operation of ["latest", "install"] as const) {
    const { calls, ops } = fixture({ [operation]: async () => { throw new Error("unavailable"); } });
    assert.equal(await checkForUpdate(ops), null);
    assert.equal(calls.at(-1), "release");
  }
});

test("installation detection and lock errors stay silent", async () => {
  for (const operation of ["installation", "lock"] as const) {
    const { ops } = fixture({ [operation]: async () => { throw new Error("permission denied"); } });
    assert.equal(await checkForUpdate(ops), null);
  }
});
