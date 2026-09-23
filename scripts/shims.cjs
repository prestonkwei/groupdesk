// Lets CLI scripts import modules that `import "server-only"` (a Next-only guard).
/* eslint-disable @typescript-eslint/no-require-imports */
const Module = require("node:module");
const path = require("node:path");
const orig = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === "server-only") return path.join(__dirname, "empty.cjs");
  return orig.call(this, request, ...rest);
};
