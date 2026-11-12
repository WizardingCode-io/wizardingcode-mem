# Probe: are the generated files held to their source?

Asked by the test-quality reviewer's F-4 of round 3 (tests/unit/version-order.test.ts:21: no test holds plugins/opencode/binary.js equal to OLDER_JS, or the shipped scripts equal to the template).

tests/integration/plugin-script.test.ts, lines 94 to 101, read on 2026-11-12:

```
const hook = (agent: string, event: string, base?: string) => run(["hook", agent, event], base);

describe("what the agents install", () => {
  test("every generated file is the one scripts/plugins.ts would write now", () => {
    for (const [path, content] of Object.entries(generated())) {
      expect({ path, content: readFileSync(join(ROOT, path), "utf8") }).toEqual({ path, content });
    }
  });
```

generated() is scripts/plugins.ts's map of every generated file to its content, built from OLDER_JS and scripts/templates/wizardingcode-mem.sh. The run below is that test file on the current tree:

```

 2 pass
 13 filtered out
 0 fail
 32 expect() calls
Ran 2 tests across 1 file. [10.00ms]
```
