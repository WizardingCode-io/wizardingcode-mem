// What an agent's proposal goes through before the store writes it: the hourly rate per
// agent, and the judge that compares the draft with what is already known. The thresholds
// are memory's (`DUPLICATE`, `SUPERSEDE`), used whole and in memory's order.
import { type Redacted, redact } from "../../core/redact.ts";
import { DUPLICATE, SUPERSEDE } from "../../distill/policy.ts";
import { heuristicJudge } from "../../judge/heuristic.ts";
import type { Judge, JudgeSource, RelateInput, RelateVerdict } from "../../judge/types.ts";
import { type Db, withWrite } from "../../store/db.ts";
import { getMeta, setMeta } from "../../store/meta.ts";
import { clip } from "../../util/text.ts";
import { isGeneric, searchTokens } from "../../util/words.ts";
import { type Hit, openProposalTexts, searchEntries } from "./index-store.ts";
import { JUDGE_BODY_MAX, NEIGHBOUR_BODY_TOKENS, NEIGHBOURS, PROPOSALS_PER_HOUR } from "./policy.ts";
import type { KnowledgeStore } from "./types.ts";
import type { VisibleRepo } from "./visible.ts";

const HOUR_MS = 3_600_000;

/** The `meta` key of an agent's counter. */
const rateKey = (agentId: string) => `knowledge.rate:${agentId}`;

/**
 * Counts one `knowledge_propose` call of an agent and says whether it may proceed. The
 * window is fixed: it opens with a call and closes an hour later. Every call counts, the
 * refused ones too, and the read and the increment are one write transaction, so two
 * processes (the server and the `tool` bridge) cannot both take the last place.
 */
export function allowProposal(db: Db, agentId: string, now: number): boolean {
  const key = rateKey(agentId);
  return withWrite(db, () => {
    let window = { windowStart: now, count: 1 };
    try {
      const held = JSON.parse(getMeta(db, key) ?? "null") as {
        windowStart?: unknown;
        count?: unknown;
      } | null;
      if (
        typeof held?.windowStart === "number" &&
        typeof held.count === "number" &&
        now - held.windowStart < HOUR_MS
      ) {
        window = { windowStart: held.windowStart, count: held.count + 1 };
      }
    } catch {
      // A row nobody can read opens a new window.
    }
    setMeta(db, key, JSON.stringify(window));
    return window.count <= PROPOSALS_PER_HOUR;
  });
}

export interface ProposalJudgement {
  /** The neighbour the draft restates; null when it restates none. */
  duplicate: { ref: string; kind: "entry" | "proposal" } | null;
  /** The entries the draft contradicts: their ids, and their `<scope>/<slug>`. */
  contradicts: { id: string; ref: string }[];
  /** The judge that answered about the entries, and its version; null with no neighbour. */
  judgedBy: JudgeSource | null;
  judgeVersion: string | null;
}

/** The entry is replaced by the draft: both of memory's thresholds. */
const contradicted = (n: RelateVerdict["perNeighbour"][number]) =>
  n.contradicts >= SUPERSEDE.minContradiction && n.relationScore >= SUPERSEDE.minRelationScore;

/** The draft says what the neighbour says, and does not correct it. */
const restates = (n: RelateVerdict["perNeighbour"][number]) =>
  n.relationScore >= DUPLICATE.minRelationScore && n.contradicts < DUPLICATE.maxContradiction;

/** The neighbours' verdicts, in the neighbours' order, read back by index. */
function inOrder<T>(items: T[], verdict: RelateVerdict) {
  return items.flatMap((item, index) => {
    const found = verdict.perNeighbour.find((n) => n.index === index);
    return found === undefined ? [] : [{ item, verdict: found }];
  });
}

/**
 * Compares a draft with what the repositories the project sees already hold. The entries
 * the search finds best (at most 8) go to the configured judge: TypeSafe when a key is set,
 * one request at most. The open proposals go to the heuristic alone, whatever is
 * configured. A change leaves its own entry, and the open proposals for it, out. Every
 * title and body is redacted and every body clipped before either judge reads it.
 */
export async function judgeProposal(
  store: KnowledgeStore,
  judge: Judge,
  repos: VisibleRepo[],
  draft: { title: string; body: string },
  without: { repoId: number; entryId: string } | null,
): Promise<ProposalJudgement> {
  const clean = (text: string) => redact(text, { env: store.env });
  const title = clean(draft.title);
  const body = clean(draft.body);

  const bodyTokens = [...new Set(searchTokens(body))]
    .filter((token) => !isGeneric(token))
    .slice(0, NEIGHBOUR_BODY_TOKENS);
  const tokens = [...searchTokens(title), ...bodyTokens];
  const repoIds = repos.map((repo) => repo.id);
  const scopeOf = new Map(repos.map((repo) => [repo.id, repo.scope]));
  const entries: Hit[] = searchEntries(
    store.db,
    tokens,
    repoIds,
    without === null ? {} : { without },
    null,
    NEIGHBOURS,
  );
  const proposals = openProposalTexts(store.db, repoIds).filter(
    (p) => !(without !== null && p.repoId === without.repoId && p.entryId === without.entryId),
  );

  // Clipped after redaction: a cut never leaves part of a secret the redactor no longer sees.
  const clipped = (text: Redacted) => clip(text, JUDGE_BODY_MAX) as Redacted;
  const neighbours = (items: { title: string; body: string }[]): RelateInput["neighbours"] =>
    items.map((item, index) => ({
      index,
      title: clean(item.title),
      body: clipped(clean(item.body)),
    }));
  const clippedDraft = { title, body: clipped(body) };

  const onEntries =
    entries.length === 0
      ? null
      : await judge.relate({ draft: clippedDraft, neighbours: neighbours(entries) });
  const onProposals =
    proposals.length === 0
      ? null
      : await heuristicJudge.relate({ draft: clippedDraft, neighbours: neighbours(proposals) });

  const judged = onEntries === null ? [] : inOrder(entries, onEntries);
  const refOf = (hit: Hit) => `${hit.scope}/${hit.slug}`;
  const contradicts = judged
    .filter(({ verdict }) => contradicted(verdict))
    .map(({ item }) => ({ id: item.id, ref: refOf(item) }));

  let duplicate: ProposalJudgement["duplicate"] = null;
  if (contradicts.length === 0) {
    const entry = judged.find(({ verdict }) => restates(verdict));
    if (entry !== undefined) {
      duplicate = { ref: refOf(entry.item), kind: "entry" };
    } else if (onProposals !== null) {
      const proposal = inOrder(proposals, onProposals).find(({ verdict }) => restates(verdict));
      if (proposal !== undefined) {
        const scope = scopeOf.get(proposal.item.repoId) ?? "workspace";
        duplicate = { ref: `${scope}/${proposal.item.id}`, kind: "proposal" };
      }
    }
  }

  if (onEntries !== null) {
    return {
      duplicate,
      contradicts,
      judgedBy: onEntries.source,
      judgeVersion: judge.versions[onEntries.source] ?? null,
    };
  }
  if (onProposals !== null) {
    return { duplicate, contradicts, judgedBy: "heuristic", judgeVersion: heuristicJudge.version };
  }
  return { duplicate: null, contradicts: [], judgedBy: null, judgeVersion: null };
}
