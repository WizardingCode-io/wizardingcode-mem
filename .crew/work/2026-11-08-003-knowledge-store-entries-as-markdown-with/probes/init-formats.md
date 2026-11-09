# Probe: what `git init` writes into `.git/config`, with the formats pinned and not

Why: the round-three fix lets a knowledge repository's `.git/config` hold only the settings `git init` writes (all under `core`). A git that defaults to another object or ref format writes them as `extensions.*`, which that rule refuses, so the store pins the formats on every git call (`-c init.defaultObjectFormat=sha1 -c init.defaultRefFormat=files`). This probe shows what the pin leaves and what the other formats write.

Run on 2026-11-09 with git 2.54.0 (Apple Git-157), in a temporary directory, with an empty global configuration and no system configuration.

```
default: exit 0
[core]
	repositoryformatversion = 0
	filemode = true
	bare = false
	logallrefupdates = true
	ignorecase = true
	precomposeunicode = true

pinned (-c init.defaultObjectFormat=sha1 -c init.defaultRefFormat=files): exit 0
[core]
	repositoryformatversion = 0
	filemode = true
	bare = false
	logallrefupdates = true
	ignorecase = true
	precomposeunicode = true

later-defaults (-c init.defaultObjectFormat=sha256 -c init.defaultRefFormat=reftable): exit 0
[extensions]
	objectformat = sha256
	refstorage = reftable
[core]
	repositoryformatversion = 1
	filemode = true
	bare = false
	logallrefupdates = true
	ignorecase = true
	precomposeunicode = true
```

What it shows:

- On this git, `git init` writes six settings, all under `core`; the pin changes nothing.
- With the other formats, the same git writes two `extensions` settings and format version 1. The allow list refuses such a repository, so a store whose git defaulted to them would refuse the repository it had just created. The pin is what prevents that.

What it does not show: a git whose built-in defaults are sha256 and reftable. None was available. Which git version first reads the two settings was not looked up; a git that does not know a setting ignores it, and such a git has no other default.
