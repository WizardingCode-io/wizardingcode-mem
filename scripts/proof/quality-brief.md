# Labelling brief: is this turn knowledge?

## Who labels

The proof sends no text to any model: it writes the samples and this brief, and reads back a labels file (ADR 0023, D-4). By default the labels come from the agent of the runtime the proof is run from: in Claude Code, a subagent given this brief, one sample file and the path of its labels file; in Codex, Codex's own agent, the same way. The author may use any other labeller, or label by hand; the file format is the same. The labeller reads the author's project text: limit the draw with `--projects` or `--exclude-projects` when that matters.

## The task

Label each turn in the sample file (an array of `{turn, memory, project, kind, importance, title, body, prompt, final, candidates}`). `prompt` and `final` are the turn as it was written; `candidates` are its sentences as the mem's segmenter cuts them, each with an `id`; in samples A and B, `title` and `body` are the memory version 1 stored from it (null in sample S). Label the turn, not the memory. Never modify any repository or user folder; write only the labels file you are given.

The question: would a developer who joins this project a month from now, and never saw this conversation, act differently for being told what this turn says?

- `knowledge`: the turn states something usable on its own by that developer: a standing rule or preference ("always / never X"), a decision and its reason, the cause of a bug and its fix, a non-obvious pitfall or behaviour, how a part of the system works or is configured.
- `mixed`: such knowledge, wrapped in the narrative of the session.
- `record`: only the state of the session: progress or status ("delivered", "done", "PR opened", "merged", "W1 closed"), a verdict of a review or a gate, a plan for this session, "your turn", a question to the user, a greeting, bookkeeping, a commit hash as news.
- `fragment`: meaningless out of context: a heading, "Two details I decided:", a lone sentence that needs the rest.

Events, states and verdicts are not knowledge, however important they were on the day. In doubt between `knowledge` and `record`, ask whether the stranger would act differently.

Three kinds of sentence are never knowledge, even when they name code, a file or a behaviour:

- **What the change did, readable in its diff or commit**: "the old guard was removed", "it now opens read-only", "added a test for X". The stranger reads the code as it is; a sentence that only tells them what this session changed adds nothing. It is knowledge only when it says why, or a pitfall the code does not show ("opened read-only because indexing holds the write lock").
- **The state, plan or next steps of this session's task**: what is running, saved, waiting, decided for now, still to do ("the four reviews are saved", "decide whether the Klarna wave goes up").
- **The user's request for this task**: an order for the work at hand ("make it scroll to the bottom"). A request is knowledge only when it states a standing rule or preference ("always…", "never…", "from now on…").

A turn is `mixed` only when at least one of its candidates is knowledge by this test; a report of a session with no such candidate is `record`, however long or technical it is.

For every `knowledge` and every `mixed` turn, list in `quotes` the `id` of every candidate that holds knowledge on its own. Use the candidates' ids, never your own wording: a `knowledge` or `mixed` label without an id of that turn's candidates is refused.

Write a JSON array to the labels file: `[{"turn": 123, "label": "knowledge|mixed|record|fragment", "why": "at most twelve words", "quotes": [4, 7]}]`, one entry per turn, in the sample's order. Then reply with the counts per label, and six examples per label (the first candidate of the turn's answer, cut at 90 characters).
