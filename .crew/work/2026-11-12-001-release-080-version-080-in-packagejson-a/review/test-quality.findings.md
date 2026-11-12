# test-quality findings for 2026-11-12-001-release-080-version-080-in-packagejson-a
reviewer: review-test-quality
read: 5 test files, 1 criterion

## Findings
- F-1 · advisory · tests/integration/plugins-packaging.test.ts:40 · AC-1 (preserve) names tests that read the version from package.json (as the criterion says), but no test asserts that the regenerated plugin manifests (.claude-plugin/plugin.json, plugins/codex, plugins/cursor, plugins/opencode/package.json) and the wrapper scripts' pinned version equal package.json. Leaving one of those at 0.7.0 would pass the suite. The preserved behaviour, "the suite keeps passing", is met. Rubric question 3 is partly met: npm-shim.test.ts:86 does pin npm/package.json to the root version, and cli.test.ts:9 pins `--version`, but the plugin files are covered only by the fake binary at plugins-packaging.test.ts:40, which reads pkg.version.
- F-2 · advisory · .env.example · No test I found asserts the version string in .env.example (a secrets path, route raised to full), so a stale or mistyped value there would go unnoticed. The change is a single version string, so this is low risk.

## Outside the change
- tests/integration/plugins-packaging.test.ts:115 · the opencode package.json is read there, but I found no `version` assertion against the root version. This is the same gap as F-1 and is debt.

## Not answerable
- Whether the "24 tests each time" before and after records in evidence.json are valid · I did not open evidence.json or the gate logs. I verified only by reading the tests that they take their version from package.json (npm-shim.test.ts:13-14, 42, 59, 86, 118; plugins-packaging.test.ts:13, 40; cli.test.ts:2, 9; build.test.ts:3).
