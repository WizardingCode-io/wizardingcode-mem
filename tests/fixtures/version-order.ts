// One table of version pairs for every implementation of "is `have` older than `wanted`":
// src/util/version.ts, the generated JavaScript older() and the shell older(). The order is
// semantic versioning's; a `have` that is missing or not a version is older than anything.
export const VERSION_ORDER: ReadonlyArray<{ have: string | null; wanted: string; older: boolean }> =
  [
    { have: null, wanted: "0.9.0", older: true },
    { have: "garbage", wanted: "0.9.0", older: true },
    { have: "0.9", wanted: "0.9.0", older: true },
    { have: "0.9.0", wanted: "0.9.0", older: false },
    { have: "0.8.0", wanted: "0.9.0", older: true },
    { have: "0.9.0", wanted: "0.8.0", older: false },
    { have: "0.10.0", wanted: "0.9.0", older: false },
    { have: "0.9.0", wanted: "0.10.0", older: true },
    { have: "0.9.0-rc.1", wanted: "0.9.0", older: true },
    { have: "0.9.0", wanted: "0.9.0-rc.1", older: false },
    { have: "0.9.0-rc.9", wanted: "0.9.0-rc.10", older: true },
    { have: "0.9.0-rc.10", wanted: "0.9.0-rc.9", older: false },
    { have: "0.9.0-aaa", wanted: "0.9.0-rc.1", older: true },
    { have: "0.9.0-rc.1", wanted: "0.9.0-rc.1.1", older: true },
    { have: "0.9.0-1", wanted: "0.9.0-rc", older: true },
    { have: "1.0.0", wanted: "0.99.99", older: false },
    { have: "0.9.0-rc.2", wanted: "0.9.1-rc.1", older: true },
    { have: "0.9.0-RC.1", wanted: "0.9.0-rc.1", older: true },
  ];
