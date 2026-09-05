const Module = require("module");
const orig = Module.prototype.require;
Module.prototype.require = function stubServerOnly(id) {
  if (id === "server-only") return {};
  return orig.apply(this, arguments);
};
