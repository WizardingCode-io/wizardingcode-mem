# github.com's answer to `releases/latest`

Run on 2026-11-12, after the spec review's design reader pointed out that `scripts/install.sh` does not rely on this shape (it follows `releases/latest/download/<file>` and reads no `Location`).

```
$ curl -sI --max-time 10 https://github.com/WizardingCode-io/wizardingcode-mem/releases/latest
HTTP/2 302
location: https://github.com/WizardingCode-io/wizardingcode-mem/releases/tag/v0.8.0

$ curl -sI --max-time 10 https://github.com/wizardingcode-io/WIZARDINGCODE-MEM/releases/latest
HTTP/2 302
location: https://github.com/wizardingcode-io/WIZARDINGCODE-MEM/releases/tag/v0.8.0

$ bun -e 'const r = await fetch("https://github.com/WizardingCode-io/wizardingcode-mem/releases/latest", { redirect: "manual", headers: { "User-Agent": "wizardingcode-mem" } }); console.log(r.status, r.headers.get("location"))'
302 https://github.com/WizardingCode-io/wizardingcode-mem/releases/tag/v0.8.0
```

What it shows: the status is 302; the `Location` is absolute; github.com echoes the owner and repository in the letter case of the request, so a request made with the constant's case gets it back; Bun's `fetch` with `redirect: "manual"` exposes the status and the header (run from source with the pinned Bun, not from a compiled binary).

What it does not show: the answer while a release's assets are uploading, the answer under rate limiting, and the compiled binary on each platform.
