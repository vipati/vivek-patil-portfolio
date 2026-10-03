// Contact form handler: validates a submission and emails it to the site owner through Gmail SMTP.
// Kept free of Azure Functions types so it can be tested with a plain request object.
"use strict";

const nodemailer = require("nodemailer");

const TOPICS = new Set([
  "A role on my team",
  "A project or collaboration",
  "One of your open-source projects",
  "Something else",
]);
const LIMITS = { name: 80, email: 120, message: 2000, body: 10_000 };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Best-effort, per-instance rate limit. Instances are recycled, so this only slows down a burst.
const RATE = { windowMs: 10 * 60 * 1000, max: 5 };
const hits = new Map();

function rateLimited(ip, now = Date.now()) {
  if (!ip) return false;
  const recent = (hits.get(ip) || []).filter((t) => now - t < RATE.windowMs);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  return recent.length > RATE.max;
}

// Remove line breaks and control characters from single-line fields (they end up in headers).
const oneLine = (s) => String(s ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
// Keep line breaks in the message body, drop other control characters.
const multiLine = (s) => String(s ?? "").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g, "").trim();

function validate(input) {
  const data = {
    name: oneLine(input.name),
    email: oneLine(input.email),
    topic: oneLine(input.topic),
    message: multiLine(input.message),
  };
  const errors = {};
  if (data.name.length < 2 || data.name.length > LIMITS.name) errors.name = "Enter your name.";
  if (!EMAIL_RE.test(data.email) || data.email.length > LIMITS.email) errors.email = "Enter a valid email address.";
  if (!TOPICS.has(data.topic)) data.topic = "Something else";
  if (data.message.length < 20 || data.message.length > LIMITS.message) errors.message = "Write between 20 and 2000 characters.";
  return { data, errors };
}

function clientIp(headers) {
  const fwd = headers.get("x-forwarded-for") || headers.get("x-client-ip") || "";
  // Azure appends ":port" to the client address.
  return fwd.split(",")[0].trim().replace(/:\d+$/, "");
}

function createTransport(env) {
  return nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user: env.GMAIL_USER, pass: env.GMAIL_APP_PASSWORD },
  });
}

function buildMail(data, env) {
  const to = env.CONTACT_TO || env.GMAIL_USER;
  return {
    from: { name: "Portfolio contact form", address: env.GMAIL_USER },
    to,
    replyTo: { name: data.name, address: data.email },
    subject: `Portfolio: ${data.topic} (from ${data.name})`,
    text: [
      `Name:  ${data.name}`,
      `Email: ${data.email}`,
      `Topic: ${data.topic}`,
      "",
      data.message,
      "",
      "--",
      "Sent from the contact form on your portfolio. Reply to this email to answer the sender.",
    ].join("\n"),
  };
}

const json = (status, body) => ({ status, jsonBody: body, headers: { "Cache-Control": "no-store" } });

/**
 * @param {{ method: string, headers: Headers, text: () => Promise<string> }} request
 * @param {{ log: Function, error: Function, warn: Function }} context
 * @param {{ env?: object, transport?: { sendMail: Function } }} [deps]
 */
async function handleContact(request, context, deps = {}) {
  const env = deps.env || process.env;
  if (request.method !== "POST") return json(405, { error: "Use POST." });

  if (!env.GMAIL_USER || !env.GMAIL_APP_PASSWORD) {
    context.error("Contact form is not configured: set GMAIL_USER and GMAIL_APP_PASSWORD.");
    return json(503, { error: "The contact form isn't set up yet." });
  }

  if (!(request.headers.get("content-type") || "").includes("application/json")) {
    return json(415, { error: "Send the form as JSON." });
  }

  const raw = await request.text();
  if (raw.length > LIMITS.body) return json(413, { error: "That message is too long." });

  let input;
  try { input = JSON.parse(raw); } catch { return json(400, { error: "The form data couldn't be read." }); }
  if (!input || typeof input !== "object") return json(400, { error: "The form data couldn't be read." });

  // Honeypot: real visitors never fill this hidden field. Pretend success so bots don't retry.
  if (oneLine(input._gotcha)) {
    context.warn("Contact form: honeypot triggered, message dropped.");
    return json(200, { ok: true });
  }

  if (rateLimited(clientIp(request.headers))) {
    return json(429, { error: "Too many messages from your connection. Try again in a few minutes." });
  }

  const { data, errors } = validate(input);
  if (Object.keys(errors).length) return json(400, { error: "Some fields need attention.", fields: errors });

  try {
    const transport = deps.transport || createTransport(env);
    await transport.sendMail(buildMail(data, env));
  } catch (err) {
    context.error(`Contact form: sending failed: ${err && err.message}`);
    return json(502, { error: "The message couldn't be sent right now." });
  }

  context.log("Contact form: message sent.");
  return json(200, { ok: true });
}

module.exports = { handleContact, validate, buildMail, clientIp, _resetRateLimit: () => hits.clear() };
