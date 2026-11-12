import { test } from "node:test";
import assert from "node:assert/strict";

process.env.BLOB_READ_WRITE_TOKEN ||= "vercel_blob_rw_teststore_secretsecretsecret";
process.env.MAIN_APP_KEY = "transfer-key";
const lib = await import("../api/_lib.js");
const { POST: share, main } = await import("../api/share.js");

// a finished transfer in a fake Blob store
const meta = { code: "ABC234", expires: Date.now() + 3600e3, files: [{ name: "photo.jpg", size: 2048, downloadUrl: "u" }] };
Object.assign(lib.store, {
  head: async (p) => (p === "t/ABC234/meta.json" ? { url: "meta" } : Promise.reject(Object.assign(new Error(), { name: "BlobNotFoundError" }))),
  fetchJson: async () => meta,
});

// a fake Deluxe Main
const people = { "tok-shivad": { id: "u1", name: "Shivad Sujith", handle: "shivad.sujith" } };
const accounts = { "friend.one": { id: "u2", name: "Friend One", handle: "friend.one" }, "shivad.sujith": people["tok-shivad"] };
let saved = [];
main.fetch = async (path, init = {}) => {
  const h = init.headers || {};
  const reply = (status, body) => new Response(JSON.stringify(body), { status });
  if (path === "/api/auth/me") {
    const u = people[String(h.Authorization).replace("Bearer ", "")];
    return u ? reply(200, { user: u, app: "transfer" }) : reply(401, {});
  }
  assert.equal(h.Authorization, "App transfer-key");
  assert.equal(h["X-Deluxe-App"], "transfer");
  if (path.startsWith("/api/server/account?handle=")) {
    const a = accounts[decodeURIComponent(path.split("=")[1])];
    return a ? reply(200, { user: a }) : reply(404, {});
  }
  if (path.startsWith("/api/data/mail/") && init.method === "PUT") {
    saved.push({ account: h["X-Deluxe-Account"], key: path.slice(15), value: JSON.parse(init.body).value });
    return reply(200, { ok: true });
  }
  return reply(404, {});
};

const owner = lib.ownerKey("ABC234");
const send = (body, token = "tok-shivad") =>
  share(new Request("https://deluxe-transfer.vercel.app/api/share", {
    method: "POST", body: JSON.stringify(body),
    headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) },
  }));

test("sends the link to a Deluxe Mail inbox, with a Sent copy", async () => {
  saved = [];
  const r = await send({ code: "abc234", owner, to: "Friend.One@deluxemail.com", note: "Here you go" });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).to, "friend.one@deluxemail.com");
  const [inbox, sent] = saved;
  assert.equal(inbox.account, "u2");
  assert.match(inbox.key, /^inbox\/[0-9]{13}-[0-9A-Za-z-]+$/);
  assert.equal(inbox.value.key, inbox.key);
  assert.equal(inbox.value.folder, "inbox");
  assert.equal(inbox.value.read, false);
  assert.equal(inbox.value.from, "Shivad Sujith <shivad.sujith@deluxemail.com>");
  assert.equal(inbox.value.subject, "Shivad Sujith sent you photo.jpg");
  assert.match(inbox.value.body, /^Here you go\n/);
  assert.match(inbox.value.body, /https:\/\/deluxe-transfer\.vercel\.app\/d\/ABC234/);
  assert.match(inbox.value.body, /Code: ABC234/);
  assert.equal(sent.account, "u1");
  assert.equal(sent.value.folder, "sent");
  assert.equal(sent.value.read, true);
});

test("a plain name works too", async () => {
  saved = [];
  assert.equal((await send({ code: "ABC234", owner, to: "friend.one" })).status, 200);
  assert.equal(saved.length, 2);
});

test("refusals", async () => {
  saved = [];
  assert.equal((await send({ code: "ABC234", owner, to: "friend.one" }, null)).status, 401);
  assert.equal((await send({ code: "ABC234", owner, to: "friend.one" }, "bad")).status, 401);
  assert.equal((await send({ code: "ABC234", owner: "x", to: "friend.one" })).status, 403);
  assert.equal((await send({ code: "ZZZ234", owner: lib.ownerKey("ZZZ234"), to: "friend.one" })).status, 404);
  assert.equal((await send({ code: "ABC234", owner, to: "someone@gmail.com" })).status, 400);
  assert.equal((await send({ code: "ABC234", owner, to: "nobody.here" })).status, 404);
  assert.equal((await send({ code: "ABC234", owner, to: "" })).status, 400);
  assert.equal(saved.length, 0);
});
