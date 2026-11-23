import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const [operation, ...options] = process.argv.slice(2);
const root = fileURLToPath(new URL("../", import.meta.url));

if (operation !== "install" && operation !== "build") {
  console.error("Usage: node scripts/run-verified.mjs <install|build>");
  process.exit(64);
}

function buildTimeout(duration) {
  const match = /^(\d+(?:\.\d+)?)([smhd]?)$/.exec(duration);
  if (!match) throw new Error("SITES_BUILD_TIMEOUT must be a duration such as 3m.");
  const multiplier = { "": 1000, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  const milliseconds = Number(match[1]) * multiplier[match[2]];
  if (!Number.isSafeInteger(milliseconds)) throw new Error("Invalid SITES_BUILD_TIMEOUT.");
  return milliseconds;
}

let command = process.execPath;
let args;
let timeout;

if (process.platform === "linux") {
  // Preserve the existing Sites preflight, cache policy and bounded build on Linux/WSL.
  command = "bash";
  args = [operation === "install" ? "scripts/install-ci.sh" : "scripts/build-verified.sh", ...options];
} else if (operation === "install") {
  const npm = process.env.npm_execpath;
  if (!npm) throw new Error("Run npm run install:ci or npm ci.");
  args = [npm, "ci", ...options];
} else {
  args = ["node_modules/vinext/dist/cli.js", "build", ...options];
  timeout = buildTimeout(process.env.SITES_BUILD_TIMEOUT ?? "3m");
}

const result = spawnSync(command, args, { cwd: root, stdio: "inherit", timeout });
if (result.error) {
  console.error(
    result.error.code === "ETIMEDOUT"
      ? "The Vinext build exceeded SITES_BUILD_TIMEOUT."
      : result.error.message,
  );
}
process.exitCode = result.status ?? (result.error?.code === "ETIMEDOUT" ? 124 : 1);
