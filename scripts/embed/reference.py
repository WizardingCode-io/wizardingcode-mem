"""Reference ids and vectors for the TypeScript embedding engine. Dev-only, run once.
Usage: python -I scripts/embed/reference.py <sentences.json> <out.json>"""
import json, sys
from importlib.metadata import version
from huggingface_hub import snapshot_download
from model2vec import StaticModel
from tokenizers import Tokenizer

REPO = "minishlab/potion-multilingual-128M"
REV = "73908c3438cf03b6a01bcb9611d62b23d0726f08"

sentences = json.load(open(sys.argv[1], encoding="utf-8"))
# from_pretrained has no revision argument in 0.6.0: fetch the pinned revision, load it from disk
model = StaticModel.from_pretrained(snapshot_download(REPO, revision=REV))
tok: Tokenizer = model.tokenizer
items = []
for text in sentences:
    normalized = tok.normalizer.normalize_str(text)
    ids = tok.encode(text, add_special_tokens=False).ids
    vector = model.encode([text])[0]
    items.append({"text": text, "normalized": normalized, "ids": ids,
                  "vector": [round(float(x), 6) for x in vector]})
json.dump({"model": REPO, "revision": REV, "model2vecVersion": version("model2vec"), "items": items},
          open(sys.argv[2], "w", encoding="utf-8"), ensure_ascii=False)
