# Brief

## Request

Three tests fail intermittently on the macOS runner and block the required check 'check (macos-latest)' on pull requests 38, 39 and 40, none of which touches their code: tests/unit/knowledge-resolve.test.ts ('migration 7: dropping a repository's rows > a repository whose folder is gone loses its rows to rebuildAll', ENOENT lstat of a projects folder), tests/unit/knowledge-index.test.ts ('rebuildAll > maps a project folder through its manifest, reports orphans, forgets folders that are gone'), and tests/integration/team-mirror.test.ts:762 ('a throw outside the per-revision blocks is recorded in mirror.last': runMirror did not throw under a read-only parent, and reported ENOENT on an entry's temporary file instead). All three remove or lose a directory and then expect a precise outcome. Find the cause on macOS and make the tests, or the code if it is at fault, deterministic.
