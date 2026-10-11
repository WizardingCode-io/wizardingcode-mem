# scripts/embed

Dev-only tooling for the TypeScript embedding engine. Nothing here ships in the binary or runs in tests.

- `reference.py` runs the original model (`minishlab/potion-multilingual-128M`, pinned revision) through `model2vec` and writes `tests/fixtures/embed/reference.json`: for each sentence in `tests/fixtures/embed/sentences.json`, the normalized text, the token ids and the 256-dimension vector. The TypeScript engine must match the ids exactly and the vectors within cosine 0.99.
- `tests/fixtures/embed/sentences.json` is the input: the golden memories and prompts, 30 edge sentences, and one long text.

The fixture was generated with `model2vec==0.6.0` and `tokenizers==0.23.3` (the version is also recorded in `reference.json` as `model2vecVersion`).

## Regenerating

Use a virtual environment outside the repository, and keep the Hugging Face cache outside it too:

```sh
python3 -m venv <scratch>/venv && <scratch>/venv/bin/pip install model2vec==0.6.0 tokenizers
HF_HOME=<scratch>/hf <scratch>/venv/bin/python -I scripts/embed/reference.py \
  tests/fixtures/embed/sentences.json tests/fixtures/embed/reference.json
```

`model2vec` 0.6.0 has no `revision` argument, so the script downloads the pinned revision with `huggingface_hub.snapshot_download` (into the Hugging Face cache; set `HF_HOME` to keep it in the scratch directory) and loads it from disk.
