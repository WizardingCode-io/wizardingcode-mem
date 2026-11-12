// Publishes one npm package of the release's tree, unless the registry already holds it.
//
//   bun scripts/release/npm.ts <package folder>
//
// Environment: VERSION, PRERELEASE, DRY_RUN. Trusted publishing needs no token.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  checkPackageVersion,
  command,
  decideNpmView,
  publishArgs,
  publishFailure,
  ReleaseError,
  run,
  summary,
  summaryLine,
} from "./lib.ts";

command("npm", () => {
  const folder = process.argv[2];
  if (folder === undefined)
    throw new ReleaseError("usage: bun scripts/release/npm.ts <package folder>");
  const version = process.env.VERSION ?? "";
  const prerelease = process.env.PRERELEASE === "true";
  const dryRun = process.env.DRY_RUN === "true";
  const pkg = JSON.parse(readFileSync(join(folder, "package.json"), "utf8")) as {
    name: string;
    version: string;
  };
  const mismatch = checkPackageVersion(pkg, version);
  if (mismatch !== null) throw new ReleaseError(mismatch);
  const already = () =>
    summary(summaryLine("npm", { kind: "already-published", name: pkg.name, version }));

  const seen = decideNpmView(run(["npm", "view", `${pkg.name}@${version}`, "version"]));
  if (seen === "published") return already();
  if (seen !== "absent")
    throw new ReleaseError(`could not ask npm about ${pkg.name}@${version}: ${seen.error}`);

  const published = run(["npm", ...publishArgs({ prerelease, dryRun })], { cwd: folder });
  if (published.code !== 0) {
    const failure = publishFailure(published.stderr);
    // The registry can answer "absent" for a version just published; the publish then says so.
    if (failure === "conflict") return already();
    throw new ReleaseError(failure.message);
  }
  process.stdout.write(published.stdout);
  summary(
    summaryLine(
      "npm",
      dryRun
        ? { kind: "would-publish", name: pkg.name, version }
        : { kind: "published", name: pkg.name, version, tag: prerelease ? "next" : "latest" },
    ),
  );
});
