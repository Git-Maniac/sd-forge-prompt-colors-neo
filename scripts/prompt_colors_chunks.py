# Finds the blocks of 75 tokens (or another size from the settings) in a prompt (for the "token blocks" display).
#
# The browser cannot count CLIP tokens by itself, so it asks this small API:
#     POST /prompt_colors/chunks    {"text": "the prompt", "size": 75}
# and gets back     {"starts": [123, 250]}
# That means: block 2 starts at character 123, block 3 starts at character 250.
# (block 1 always starts at character 0, so it is not in the list)
#
# The real tokenizer of the loaded model is used, with the same rules as the WebUI
# (BREAK, comma backtracking, weights). Models without 75-token blocks (Flux, ...) get an empty list.

import re

from fastapi import Body

from modules import script_callbacks, sd_models



# Gives how many characters at the start of the text are a "$$" prefix, for example:
#     "2$$a|b"  -> 3      (the prefix is "2$$")
#     "2-3$$a"  -> 5      (the prefix is "2-3$$")
#     "a|b"     -> 0      (no prefix)
def find_prefix_length(inner):
    allowed = "0123456789- "    # a prefix before the first $$ has only digits, a minus and spaces
    first_pipe = inner.find("|")

    # is there a "$$" before the first | ?
    dollars = inner.find("$$")
    if dollars == -1 or (first_pipe != -1 and dollars > first_pipe):
        return 0

    # the text in front of the "$$" must be only digits, minus and spaces (like "2" or "2-3")
    for character in inner[:dollars]:
        if character not in allowed:
            return 0
    prefix_length = dollars + 2

    # an optional second "$$" (like "2$$ and $$") is part of the prefix too
    second = inner.find("$$", prefix_length)
    if second != -1 and (first_pipe == -1 or second < first_pipe):
        prefix_length = second + 2

    return prefix_length


# One Dynamic Prompts choice like {a|b|c} gives only ONE of its words in the end, so it is counted
# as one word: the first choice stays, the brackets, the | and the other choices are replaced by spaces.
# Parts of the form {2$$a|b|c} (take 2 choices) are counted as one choice too.
# ${var=x} and %{...} are not choices, they are skipped.
def keep_first_choice(match):
    inner = match.group(1)

    # the "2$$" or "2-3$$" or "2$$ and $$" in front of the choices is not part of the text
    prefix_length = find_prefix_length(inner)

    # the first choice ends at the first | (or at the end)
    first_end = inner.find("|", prefix_length)
    if first_end == -1:
        first_end = len(inner)

    # same length as before: spaces, the first choice, spaces
    return " " * (1 + prefix_length) + inner[prefix_length:first_end] + " " * (len(inner) - first_end) + " "


# Comments, extra networks (<lora:...>) and unused choices are not counted. They are replaced by
# spaces of the same length, so all character positions stay the same.
def blank_out(text):
    def spaces(match):
        return re.sub(r"[^\n]", " ", match.group(0))    # keep new lines, replace all other characters

    text = re.sub(r"/\*.*?\*/", spaces, text, flags=re.DOTALL)    # /* ... */
    text = re.sub(r"(#|//)[^\n]*", spaces, text)                  # # ... and // ...
    text = re.sub(r"<[^<>\n]*>", spaces, text)                    # <lora:name:0.8>

    # choices, the innermost first (so {a|{b|c}} works): repeat until nothing changes
    for _ in range(10):
        changed = re.sub(r"(?<![$%])\{([^{}]*)\}", keep_first_choice, text)
        if changed == text:
            break
        text = changed

    return text


# The engine from the loaded model, or - as long as no model is loaded (Forge loads it at the first
# generation) - a small engine of our own that only has the CLIP tokenizer (this is enough to count).
fallback_engine = None


def make_fallback_engine():
    import os

    from transformers import CLIPTokenizer

    from backend.text_processing.sd_engine import ClipEngine
    from backend.text_processing.textual_inversion import EmbeddingDatabase

    # the tokenizer of Stable Diffusion 1.5 (the same one is used by SDXL for its first text encoder)
    path = os.path.join(os.getcwd(), "backend", "huggingface", "runwayml", "stable-diffusion-v1-5", "tokenizer")
    tokenizer = CLIPTokenizer.from_pretrained(path)

    # ClipEngine.__init__ needs a text encoder, so it is skipped and only the needed values are set
    engine = ClipEngine.__new__(ClipEngine)
    engine.tokenizer = tokenizer
    engine.embeddings = EmbeddingDatabase(tokenizer, 768)
    engine.chunk_length = 75
    engine.id_start = tokenizer.bos_token_id
    engine.id_end = tokenizer.eos_token_id
    engine.id_pad = tokenizer.pad_token_id
    engine.comma_token = tokenizer.get_vocab()[",</w>"]
    return engine


# gives the text engine to count with, or None if the model has no 75-token blocks
def get_engine():
    global fallback_engine

    model = sd_models.model_data.sd_model
    name = type(model).__name__

    # SD 1.x has "text_processing_engine", SDXL has "..._l" (the second engine "..._g" has the same blocks)
    if name == "StableDiffusion":
        return getattr(model, "text_processing_engine", None)
    if name == "StableDiffusionXL":
        return getattr(model, "text_processing_engine_l", None)

    # no model loaded yet: count with our own engine
    if name == "FakeInitialModel":
        if fallback_engine is None:
            fallback_engine = make_fallback_engine()
        return fallback_engine

    return None    # Flux, Qwen, ... have no 75-token blocks


# The tokens of the words that were already tokenized (the same word gives the same tokens)
word_cache = {}


# gives the word pattern of the CLIP tokenizer (it cuts a text into the words that are tokenized one by one)
def get_word_pattern(tokenizer):
    pattern = getattr(tokenizer, "pat", None)
    if pattern is None:
        import regex

        pattern = regex.compile(r"""<\|startoftext\|>|<\|endoftext\|>|'s|'t|'re|'ve|'m|'ll|'d|[\p{L}]+|[\p{N}]|[^\s\p{L}\p{N}]+""", regex.IGNORECASE)
    return pattern


# tokens of one word (only once for every word, then it comes from the cache)
def tokenize_word(tokenizer, word):
    key = (id(tokenizer), word)
    if key not in word_cache:
        if len(word_cache) > 50000:
            word_cache.clear()    # do not grow forever
        word_cache[key] = tokenizer(word, truncation=False, add_special_tokens=False)["input_ids"]
    return word_cache[key]


# turns the text into a list of tokens, every token with the position of its word in the text
# an item is (token id, position), or (None, None) for BREAK
def tokenize_with_positions(engine, text):
    from backend.text_processing import parsing

    tokenizer = engine.tokenizer
    pattern = get_word_pattern(tokenizer)

    # the same cutting into parts (text and weight) as the WebUI does it
    parts = parsing.parse_prompt_attention(text, engine.emphasis.name)

    items = []
    cursor = 0    # the position in the original text, the parts are found one after the other
    for part, weight in parts:
        if part == "BREAK" and weight == -1:
            items.append((None, None))
            found = text.find("BREAK", cursor)
            if found != -1:
                cursor = found + 5
            continue

        # the part has no brackets and no weights any more, so for every character of the part
        # look up where it is in the original text (skipping the brackets and weights in between)
        positions = []
        for character in part:
            while cursor < len(text) and text[cursor] != character:
                cursor += 1
            positions.append(min(cursor, max(len(text) - 1, 0)))
            cursor += 1

        for match in pattern.finditer(part):
            for token in tokenize_word(tokenizer, match.group(0)):
                items.append((token, positions[match.start()]))

    return items


# the same rules as ClipEngine.tokenize_line of the WebUI (full blocks, BREAK, comma backtracking),
# but it remembers the position of the first token of every block
def split_into_chunks(items, engine, size):
    from modules.shared import opts

    backtrack = opts.comma_padding_backtrack
    chunks = []
    chunk = []
    last_comma = -1

    def next_chunk():
        nonlocal chunk, last_comma
        chunks.append(chunk)
        chunk = []
        last_comma = -1

    for token, position in items:
        if token is None:    # BREAK
            next_chunk()
            continue

        if token == engine.comma_token:
            last_comma = len(chunk)
        elif backtrack != 0 and len(chunk) == size and last_comma != -1 and len(chunk) - last_comma <= backtrack:
            # the block ends at the last comma, the tokens behind it go to the next block
            cut = last_comma + 1
            moved = chunk[cut:]
            chunk = chunk[:cut]
            next_chunk()
            chunk = moved

        if len(chunk) == size:
            next_chunk()

        chunk.append((token, position))

    if chunk or not chunks:
        next_chunk()

    return chunks


# returns the character positions where block 2, 3, 4, ... start
# (the text is tokenized only once, so this is fast also for very long prompts)
def find_chunk_starts(text, size=75):
    engine = get_engine()
    if engine is None:
        return []

    text = blank_out(text)
    items = tokenize_with_positions(engine, text)
    chunks = split_into_chunks(items, engine, size)

    # block 1 starts at 0, so only the other blocks are listed (empty blocks have no start)
    return [chunk[0][1] for chunk in chunks[1:] if chunk]


def add_api(demo, app):
    @app.post("/prompt_colors/chunks")
    def chunks_route(payload: dict = Body(...)):
        text = str(payload.get("text", ""))

        # the block size from the settings (anything that is not a number from 1 to 10000 gives 75)
        try:
            size = int(payload.get("size", 75))
        except (TypeError, ValueError):
            size = 75
        if size < 1 or size > 10000:
            size = 75

        try:
            return {"starts": find_chunk_starts(text, size)}
        except Exception as error:
            print(f"[Prompt Colors] chunk search failed: {error}")
            return {"starts": []}


script_callbacks.on_app_started(add_api)
