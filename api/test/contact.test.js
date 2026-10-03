"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const nodemailer = require("nodemailer");
const { handleContact, _resetRateLimit } = require("../src/contact");

const ENV = { GMAIL_USER: "owner@gmail.com", GMAIL_APP_PASSWORD: "app-password" };
const VALID = { name: "Ada Lovelace", email: "ada@example.com", topic: "A role on my team", message: "Hi Vivek, we're hiring a platform lead and would love to talk.", _gotcha: "" };

const context = () => {
  const logs = [];
  return { logs, log: (m) => logs.push(m), warn: (m) => logs.push(m), error: (m) => logs.push(m) };
};
const request = (body, { method = "POST", type = "application/json", ip = "203.0.113.7:51234" } = {}) => ({
  method,
  headers: new Headers({ "content-type": type, "x-forwarded-for": ip }),
  text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
});
// Real nodemailer transport that renders the email instead of sending it.
const capture = () => {
  const sent = [];
  const t = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: "unix" });
  return { sent, sendMail: async (mail) => { const info = await t.sendMail(mail); sent.push(info.message.toString()); return info; } };
};

test.beforeEach(() => _resetRateLimit());

test("sends a valid message to the owner with Reply-To set to the visitor", async () => {
  const transport = capture();
  const res = await handleContact(request(VALID), context(), { env: ENV, transport });
  assert.equal(res.status, 200);
  assert.deepEqual(res.jsonBody, { ok: true });
  assert.equal(transport.sent.length, 1);
  const mail = transport.sent[0];
  assert.match(mail, /^To: owner@gmail\.com$/m);
  assert.match(mail, /^Reply-To: Ada Lovelace <ada@example\.com>$/m);
  assert.match(mail, /^Subject: Portfolio: A role on my team \(from Ada Lovelace\)$/m);
  assert.match(mail, /hiring a platform lead/);
});

test("CONTACT_TO overrides the recipient", async () => {
  const transport = capture();
  await handleContact(request(VALID), context(), { env: { ...ENV, CONTACT_TO: "inbox@example.org" }, transport });
  assert.match(transport.sent[0], /^To: inbox@example\.org$/m);
});

test("returns 503 when Gmail settings are missing", async () => {
  const res = await handleContact(request(VALID), context(), { env: {}, transport: capture() });
  assert.equal(res.status, 503);
});

test("rejects non-POST and non-JSON requests", async () => {
  assert.equal((await handleContact(request(VALID, { method: "GET" }), context(), { env: ENV })).status, 405);
  assert.equal((await handleContact(request("name=x", { type: "application/x-www-form-urlencoded" }), context(), { env: ENV })).status, 415);
  assert.equal((await handleContact(request("{not json"), context(), { env: ENV })).status, 400);
});

test("returns field errors for invalid input and sends nothing", async () => {
  const transport = capture();
  const res = await handleContact(request({ name: "A", email: "nope", message: "short" }), context(), { env: ENV, transport });
  assert.equal(res.status, 400);
  assert.deepEqual(Object.keys(res.jsonBody.fields).sort(), ["email", "message", "name"]);
  assert.equal(transport.sent.length, 0);
});

test("rejects oversized bodies", async () => {
  const res = await handleContact(request({ ...VALID, message: "x".repeat(20_000) }), context(), { env: ENV, transport: capture() });
  assert.equal(res.status, 413);
});

test("honeypot submissions get a fake success and are not sent", async () => {
  const transport = capture();
  const res = await handleContact(request({ ...VALID, _gotcha: "Acme Corp" }), context(), { env: ENV, transport });
  assert.equal(res.status, 200);
  assert.equal(transport.sent.length, 0);
});

test("line breaks in the name cannot inject email headers", async () => {
  const transport = capture();
  await handleContact(request({ ...VALID, name: "Eve\r\nBcc: victim@example.com" }), context(), { env: ENV, transport });
  assert.doesNotMatch(transport.sent[0], /^Bcc:/m);
});

test("unknown topics fall back to 'Something else'", async () => {
  const transport = capture();
  await handleContact(request({ ...VALID, topic: "<script>" }), context(), { env: ENV, transport });
  assert.match(transport.sent[0], /^Subject: Portfolio: Something else/m);
});

test("rate-limits a burst from one address", async () => {
  const transport = capture();
  const statuses = [];
  for (let i = 0; i < 7; i++) statuses.push((await handleContact(request(VALID), context(), { env: ENV, transport })).status);
  assert.deepEqual(statuses, [200, 200, 200, 200, 200, 429, 429]);
});

test("SMTP failures return 502 without leaking details", async () => {
  const ctx = context();
  const res = await handleContact(request(VALID), ctx, { env: ENV, transport: { sendMail: async () => { throw new Error("535 bad credentials"); } } });
  assert.equal(res.status, 502);
  assert.doesNotMatch(JSON.stringify(res.jsonBody), /535/);
  assert.ok(ctx.logs.some((l) => l.includes("535")));
});

test("the function registers with the Azure Functions runtime", () => {
  assert.doesNotThrow(() => require("../src/functions/contact"));
});
