// What each extension we ship is built from, and whether that changed since a release tag.
// Shared by extension-versions.mjs (a changed extension needs a new version) and update-path.mjs
// (only a changed extension's version changes with an update). Runs git in the current directory.
import { execFileSync } from "node:child_process";

export const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const json = (ref, file) => JSON.parse(git("show", `${ref}:${file}`));

// What ends up in the extension folder: not tests, docs or dev tooling.
export const shipped = {
  enki: {
    name: "Enki",
    paths: ["extension", ":(exclude)extension/test", ":(exclude)extension/docs", ":(exclude)extension/docker", ":(exclude)extension/docker-compose.yml", ":(exclude,glob)extension/**/*.md"],
    version: (ref) => json(ref, "extension/package.json").version,
    bump: "extension/package.json and extension/package-lock.json",
  },
  shield: {
    name: "Enki Shield",
    paths: ["shield", ":(exclude,glob)shield/**/*.md"],
    version: (ref) => json(ref, "shield/manifest.json").version,
    bump: "shield/manifest.json",
  },
  ublock: {
    name: "uBlock Origin Lite (with Enki's patch)",
    paths: ["patches/ublock-lite-shields.js", "config/ublock-extension.pub"],
    version: (ref) => json(ref, "upstream.json").blocker.version,
    bump: "nothing of ours: its version is uBlock's, so ship a patch change together with a uBlock update",
  },
};

const semver = (t) => t.replace(/^v/, "").split(".").map(Number);
const newer = (a, b) => { const x = semver(a), y = semver(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };

/** The newest v*.*.* tag that is not HEAD itself, or undefined. */
export function previousTag() {
  const head = git("rev-parse", "HEAD");
  const tags = git("tag", "--list", "v*.*.*").split("\n").filter((t) => /^v\d+\.\d+\.\d+$/.test(t)).sort(newer).reverse();
  return tags.find((t) => git("rev-list", "-n", "1", t) !== head);
}

/** Shipped files of `ext` (a key of `shipped`) that differ between `tag` and HEAD. */
export const changedSince = (tag, ext) => git("diff", "--name-only", tag, "HEAD", "--", ...shipped[ext].paths).split("\n").filter(Boolean);
