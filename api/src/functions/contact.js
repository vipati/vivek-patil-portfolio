"use strict";

const { app } = require("@azure/functions");
const { handleContact } = require("../contact");

// POST /api/contact
app.http("contact", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "contact",
  handler: (request, context) => handleContact(request, context),
});
