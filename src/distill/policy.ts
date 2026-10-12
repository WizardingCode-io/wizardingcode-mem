// Every threshold that turns a judgment into an action lives here, in code, so that it
// can be read, tested and tuned against the golden set without touching a judge.

/** A turn is distilled into a memory when its `worthSaving` reaches this. */
export const SAVE_THRESHOLD = 0.5;

/** A sentence becomes one of a memory's facts when its durability reaches this. */
export const DURABLE_THRESHOLD = 0.5;

export const MAX_FACTS = 5;
export const TITLE_MAX_CHARS = 120;

/** The draft repeats an existing memory: reinforce that memory instead of storing the draft. */
export const DUPLICATE = { minRelationScore: 1.5, maxContradiction: 0.5 };

/** The draft replaces an existing memory: store the draft and mark the old one superseded. */
export const SUPERSEDE = { minContradiction: 0.7, minRelationScore: 0.8 };

/**
 * Two memories in different projects state the same rule by meaning when the cosine of their
 * vectors reaches this. Deliberately high (above the search floor of 0.32): a proposal only
 * asks the author, but a loose one would group rules that merely share a topic. Not yet
 * calibrated against labelled pairs.
 */
export const SAME_MEANING = 0.8;

/** A judge's "not personal" drops a proposed rule only when it is at least this sure. */
export const NOT_PERSONAL = { minConfidence: 0.7 };
