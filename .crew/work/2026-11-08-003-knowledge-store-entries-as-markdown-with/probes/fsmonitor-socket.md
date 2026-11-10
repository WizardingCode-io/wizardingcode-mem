# Probe: what a person's own git leaves in `.git/` with the file monitor on

Asked by the risk reviewer in round five (F-1, and "Not answerable": what outside the store leaves something in `.git/` that is neither a file nor a folder). It reasoned from git's documentation that a git with `core.fsmonitor=true` leaves a socket at `.git/fsmonitor--daemon.ipc`, and did not run it. The data reviewer names the same case.

Run on 2026-11-09 with git 2.54.0 (Apple Git-157) on macOS, in a temporary repository made with plain git, an empty global configuration and no system configuration. The daemon was stopped before the folder was removed.

```
git version 2.54.0 (Apple Git-157)
init: exit 0
add: exit 0
commit: exit 0
entries of .git that are neither file nor folder, before: []
status with core.fsmonitor=true: exit 0
entries of .git that are neither file nor folder, after: ["fsmonitor--daemon.ipc (socket)"]
daemon status: exit 0
daemon stop: exit 0
entries of .git that are neither file nor folder, once stopped: []
```

What it shows:

- One `git status` with `core.fsmonitor=true` starts the daemon and leaves a socket at `.git/fsmonitor--daemon.ipc`. The socket stays while the daemon runs, and goes when the daemon is stopped.
- The code under review refuses a repository whose `.git/` holds anything but regular files and folders, so it refuses a knowledge repository in which a person's own git, set up this way, has run. The store's own git calls never start the daemon: they pass `core.fsmonitor=false`.

What it does not show: Linux and Windows, where the daemon's channel is not a socket file in `.git/`; GUI clients, Git LFS and other tools, none of which was run.
