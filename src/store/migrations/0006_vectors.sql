-- One vector per memory, from the optional semantic model (ADR 0017). `model` names the pack
-- that made it, so a vector from another model is ignored until the backfill rewrites it. The
-- vector is int8 with one scale; an empty `vec` marks a memory with nothing to embed.
CREATE TABLE memory_vectors (
  memory_id INTEGER PRIMARY KEY REFERENCES memories(id) ON DELETE CASCADE,
  model TEXT NOT NULL,
  scale REAL NOT NULL,
  vec BLOB NOT NULL
);
CREATE INDEX memory_vectors_model ON memory_vectors(model);
