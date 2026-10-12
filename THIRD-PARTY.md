# Third-party material

- minishlab/potion-multilingual-128M (static embeddings by Minish Lab): MIT, per the model card (front matter `license: mit`), https://huggingface.co/minishlab/potion-multilingual-128M . It is a distillation of BAAI/bge-m3 and uses its tokenizer.
- BAAI/bge-m3 (the model it was distilled from, and the source of the tokenizer and normaliser table): MIT, copyright (c) 2022 staoxiao per the FlagEmbedding repository, https://huggingface.co/BAAI/bge-m3 . Built on XLM-RoBERTa (FacebookAI/xlm-roberta-base, tagged MIT).
- A test subset of the model lives in `tests/fixtures/embed/subset.wcpack`; the full licence text and the notices are in `tests/fixtures/embed/LICENSE-potion.txt`. A full pack, if shipped, must carry the same notices.
