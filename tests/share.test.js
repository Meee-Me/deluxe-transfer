import { test } from "node:test";
import assert from "node:assert/strict";

process.env.BLOB_ACCESS = "public";
process.env.BLOB_READ_WRITE_TOKEN ||= "vercel_blob_rw_teststore_secretsecretsecret";
process.env.MAIN_APP_KEY = "  transfer-key\n";
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
  if (/^\/api\/data\/(mail|transfer)\//.test(path) && init.method === "PUT") {
    const [, , , app, ...rest] = path.split("/");
    saved.push({ app, account: h["X-Deluxe-Account"], key: rest.join("/"), value: JSON.parse(init.body).value });
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

const { POST: lookup } = await import("../api/lookup.js");
const { parseRecipient } = await import("../api/_people.js");
const mailOf = (app) => saved.filter((x) => x.app === app);

test("every way of writing someone", () => {
  for (const input of ["friend.one", "@friend.one", "Friend.One@deluxemail.com", "Friend One <friend.one@deluxemail.com>", "mailto:friend.one@deluxemail.com", "Friend One", " 'friend.one' "]) {
    assert.deepEqual(parseRecipient(input), { handle: "friend.one" }, input);
  }
  assert.match(parseRecipient("someone@gmail.com").error, /isn't a Deluxe address/);
  assert.ok(parseRecipient("").error);
});

test("sends to several people's Deluxe Transfer inbox, no mail", async () => {
  saved = [];
  const r = await send({ code: "abc234", owner, to: ["Friend.One@deluxemail.com", "@shivad.sujith", "friend.one", "nobody.here"], note: "Here you go" });
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(d.sent, 2);
  assert.deepEqual(d.results.map((x) => [x.ok, x.handle || x.error]), [
    [true, "friend.one"], [true, "shivad.sujith"], [false, "Nobody is called nobody.here."],
  ]);
  assert.equal(mailOf("mail").length, 0, "nothing goes to Deluxe Mail");
  const inbox = mailOf("transfer").find((x) => x.account === "u2");
  assert.equal(inbox.key, "received/ABC234");
  assert.equal(inbox.value.unread, true);
  assert.equal(inbox.value.note, "Here you go");
  assert.deepEqual(inbox.value.from, { name: "Shivad Sujith", handle: "shivad.sujith" });
  assert.equal(inbox.value.files[0].name, "photo.jpg");
  assert.equal(inbox.value.link, "https://deluxe-transfer.vercel.app/d/ABC234");
});

test("lookup shows who someone is", async () => {
  const ask = (to, token = "tok-shivad") => lookup(new Request("https://x.test/api/lookup", { method: "POST", body: JSON.stringify({ to }), headers: token ? { authorization: "Bearer " + token } : {} }));
  assert.deepEqual(await (await ask("Friend One")).json(), { handle: "friend.one", name: "Friend One", address: "friend.one@deluxemail.com" });
  assert.equal((await ask("nobody.here")).status, 404);
  assert.equal((await ask("x@gmail.com")).status, 400);
  assert.equal((await ask("friend.one", null)).status, 401);
});

test("refusals", async () => {
  saved = [];
  assert.equal((await send({ code: "ABC234", owner, to: "friend.one" }, null)).status, 401);
  assert.equal((await send({ code: "ABC234", owner, to: "friend.one" }, "bad")).status, 401);
  assert.equal((await send({ code: "ABC234", owner: "x", to: "friend.one" })).status, 403);
  assert.equal((await send({ code: "ZZZ234", owner: lib.ownerKey("ZZZ234"), to: "friend.one" })).status, 404);
  assert.equal((await send({ code: "ABC234", owner, to: "someone@gmail.com" })).status, 400);
  assert.equal((await send({ code: "ABC234", owner, to: "nobody.here" })).status, 400);
  assert.equal((await send({ code: "ABC234", owner, to: "" })).status, 400);
  assert.equal(saved.length, 0);
});
