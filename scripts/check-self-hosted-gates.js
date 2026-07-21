#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const repositoryRoot = path.resolve(__dirname, "..");
const sourceRoots = [
  "worklenz-frontend/src",
  "worklenz-frontend/worklenz-ce",
  "worklenz-backend/src",
];

// Compatibility debt may decrease while components move to explicit capabilities. Any increase
// is a release failure because it would introduce a new subscription/paywall dependency.
const maximumOccurrences = {
  businessPlanRequired: 0,
  selfHostedExcluded: 0,
  promptUpgrade: 55,
  hasBusinessAccess: 63,
  SEAT_LIMIT_EXCEEDED: 19,
  CUSTOM_FIELD_LIMIT_EXCEEDED: 2,
  "/worklenz/admin-center/billing": 11,
};

const files = [];
function visit(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) visit(fullPath);
    else if (/\.(ts|tsx)$/.test(entry.name)) files.push(fullPath);
  }
}

sourceRoots.forEach(root => visit(path.join(repositoryRoot, root)));
const source = files.map(file => fs.readFileSync(file, "utf8")).join("\n");
const failures = [];

for (const [token, maximum] of Object.entries(maximumOccurrences)) {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const count = (source.match(new RegExp(escaped, "g")) || []).length;
  if (count > maximum) failures.push(`${token}: ${count} exceeds compatibility baseline ${maximum}`);
  process.stdout.write(`${token}: ${count}/${maximum}\n`);
}

if (failures.length) {
  process.stderr.write(`New commercial gate usage detected:\n${failures.join("\n")}\n`);
  process.exit(1);
}
