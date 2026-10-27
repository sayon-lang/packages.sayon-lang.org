// What the protocol promises (PROTOCOL.md), checked against the registry
// run by local.mjs: accounts and tokens, publishing and its refusals,
// information, search, and archives with their digests.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ADMIN = "test-admin-token";
let registry;
let url;
let tokens;
let data;

before(async () => {
  data = mkdtempSync(join(tmpdir(), "sayon-registry-test-"));
  registry = spawn(
    process.execPath,
    ["--no-warnings", join(root, "local.mjs"), "--port", "0", "--data", data, "--account", "ada", "--account", "bo"],
    { env: { ...process.env, SAYON_REGISTRY_ADMIN_TOKEN: ADMIN }, stdio: ["ignore", "pipe", "inherit"] },
  );
  const [line] = await createInterface({ input: registry.stdout })[Symbol.asyncIterator]().next().then((r) => [r.value]);
  ({ url, accounts: tokens } = JSON.parse(line));
});

after(() => {
  registry.kill();
  rmSync(data, { recursive: true, force: true });
});

/// An archive of `files`, `[path, text]` pairs, in the order given.
function archive(files) {
  const parts = [Buffer.from("sayon-package-digest-1\0")];
  const length = (n) => {
    const bytes = Buffer.alloc(8);
    bytes.writeBigUInt64LE(BigInt(n));
    return bytes;
  };
  for (const [path, text] of files) {
    const name = Buffer.from(path);
    const content = Buffer.from(text);
    parts.push(length(name.length), name, length(content.length), content);
  }
  return Buffer.concat(parts);
}

/// A package's archive, its files in order.
function pkg(name, version, { dependencies = "", source = "function f() -> integer\n    return 1\n" } = {}) {
  const manifest = `[package]\nname = "${name}"\nversion = "${version}"\ndescription = "Helpers for text"\n${dependencies}`;
  return archive([
    ["sayon.toml", manifest],
    ["src/main.sayon", source],
  ]);
}

async function call(method, path, { token, body } = {}) {
  const headers = token ? { authorization: `Bearer ${token}` } : {};
  const response = await fetch(`${url}/api/v1${path}`, { method, headers, body });
  const type = response.headers.get("content-type") ?? "";
  const answer = type.includes("json") ? await response.json() : Buffer.from(await response.arrayBuffer());
  return { status: response.status, answer, headers: response.headers };
}

const publish = (name, version, body, account = "ada") =>
  call("PUT", `/packages/${name}/${version}`, { token: tokens[account], body });

test("the registry tells its protocol", async () => {
  assert.deepEqual((await call("GET", "")).answer, { protocol: 1 });
  assert.equal((await call("GET", "/nothing")).status, 404);
});

test("tokens name their accounts", async () => {
  assert.equal((await call("GET", "/me")).status, 401);
  assert.equal((await call("GET", "/me", { token: "sayon_unknown" })).status, 401);
  assert.deepEqual((await call("GET", "/me", { token: tokens.ada })).answer, { name: "ada" });
});

test("only the operator makes accounts, and a new token replaces the old", async () => {
  const make = (token, body) => call("POST", "/users", { token, body: JSON.stringify(body) });
  assert.equal((await make(tokens.ada, { name: "cy" })).status, 403);
  assert.equal((await make(ADMIN, { name: "Not A Name" })).status, 400);
  const made = await make(ADMIN, { name: "cy" });
  assert.equal(made.status, 201);
  assert.equal((await make(ADMIN, { name: "cy" })).status, 409);
  const replaced = await make(ADMIN, { name: "cy", replace: true });
  assert.equal(replaced.status, 200);
  assert.equal((await call("GET", "/me", { token: made.answer.token })).status, 401);
  assert.equal((await call("GET", "/me", { token: replaced.answer.token })).answer.name, "cy");
});

test("a version is published once, by its package's owner", async () => {
  const body = pkg("strings", "0.1.0");
  const published = await publish("strings", "0.1.0", body);
  assert.equal(published.status, 201);
  assert.equal(published.answer.digest, `sha256:${createHash("sha256").update(body).digest("hex")}`);
  assert.equal((await publish("strings", "0.1.0", pkg("strings", "0.1.0", { source: "changed" }))).status, 409);
  const other = await publish("strings", "0.2.0", pkg("strings", "0.2.0"), "bo");
  assert.equal(other.status, 403);
  assert.match(other.answer.error, /belongs to the account `ada`/);
  assert.equal((await call("PUT", "/packages/strings/0.3.0", { body: pkg("strings", "0.3.0") })).status, 401);
});

test("archives that a package could not be are refused", async () => {
  const refused = async (name, version, body) => {
    const answer = await publish(name, version, body);
    assert.equal(answer.status, 400, JSON.stringify(answer.answer));
    return answer.answer.error;
  };
  assert.match(await refused("texts", "1.0.0", pkg("texts", "2.0.0")), /not texts 1.0.0/);
  assert.match(await refused("texts", "1.0", pkg("texts", "1.0")), /not a version/);
  assert.match(await refused("texts", "1.0.0", Buffer.from("not an archive")), /damaged/);
  const files = [["sayon.toml", '[package]\nname = "texts"\nversion = "1.0.0"\n']];
  assert.match(await refused("texts", "1.0.0", archive([["../outside", "x"], ...files])), /cannot/);
  assert.match(await refused("texts", "1.0.0", archive([["src/z", "x"], ["src/a", "y"], ...files])), /out of order/);
  assert.match(await refused("texts", "1.0.0", archive([["Src/a", "x"], ...files, ["src/a", "y"]])), /only in case/);
  const local = pkg("texts", "1.0.0", { dependencies: '[dependencies]\nhelpers = { path = "../helpers" }\n' });
  assert.match(await refused("texts", "1.0.0", local), /not from a registry/);
  assert.equal((await call("GET", "/packages/texts")).status, 404);
});

test("a package tells its versions, dependencies, and latest release", async () => {
  const words = pkg("words", "1.0.0-beta.1", { dependencies: '[dependencies]\nstrings = "0.1"\n' });
  assert.equal((await publish("words", "1.0.0-beta.1", words)).status, 201);
  assert.equal((await call("GET", "/packages/words")).answer.latest, "1.0.0-beta.1");
  assert.equal((await publish("words", "0.9.0", pkg("words", "0.9.0"))).status, 201);
  const information = (await call("GET", "/packages/words")).answer;
  assert.equal(information.owner, "ada");
  assert.equal(information.latest, "0.9.0");
  assert.deepEqual(
    information.versions.map((v) => v.version),
    ["0.9.0", "1.0.0-beta.1"],
  );
  assert.deepEqual(information.versions[1].dependencies, [{ alias: "strings", package: "strings", requirement: "0.1" }]);
});

test("an archive comes back as it was published, with its digest", async () => {
  const body = pkg("bytes", "2.0.0");
  const { answer } = await publish("bytes", "2.0.0", body);
  const fetched = await call("GET", "/packages/bytes/2.0.0/archive");
  assert.equal(fetched.status, 200);
  assert.deepEqual(fetched.answer, body);
  assert.equal(fetched.headers.get("x-sayon-digest"), answer.digest);
  assert.equal((await call("GET", "/packages/bytes/9.9.9/archive")).status, 404);
});

test("search finds names and descriptions, an exact name first", async () => {
  const found = (await call("GET", "/search?q=strings")).answer.packages.map((p) => p.name);
  assert.equal(found[0], "strings");
  const described = (await call("GET", "/search?q=helpers%20for")).answer.packages.map((p) => p.name);
  assert.ok(described.includes("words") && described.includes("strings"), described.join(", "));
  assert.deepEqual((await call("GET", "/search?q=zzz")).answer.packages, []);
  assert.equal((await call("GET", "/search?q=&limit=1")).answer.packages.length, 1);
});
