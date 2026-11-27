# SD Forge Prompt Colors Neo Extension for Forge-Neo

![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)
![Python](https://img.shields.io/badge/python-3.10+-blue.svg)
![Gradio](https://img.shields.io/badge/Gradio-supported-orange.svg)

**sd-forge-prompt-colors-neo** is a seamless extension for [sd-webui-forge-neo](https://github.com/Haoming02/sd-webui-forge-classic)

Prettier prompts with colorful tags. Brackets, keywords, weights, wildcards, comments and more are colored in the prompt boxes (txt2img, img2img and the hires prompts, positive and negative). All colors can be changed in the settings.

It supports:

  sd-webui-forge-neo from Haoming02: <https://github.com/Haoming02/sd-webui-forge-classic>
  
  sd-dynamic-prompts-neo from abzaloff: <https://github.com/abzaloff/sd-dynamic-prompts>
  
  sd-webui-tagcomplete-neo from eduardoabreu81: <https://github.com/eduardoabreu81/sd-webui-tagcomplete-neo>

## Colors and functions

All colors are set in **Settings -> Extensions -> Prompt Colors**. Every color field is painted with the color that is written in it. An empty or invalid color switches that color (or function) off. The default colors are the ones of the Visual Studio Code theme "Dark+".

| What | Example | Setting | Default |
| --- | --- | --- | --- |
| Keywords (the list is editable, separated by commas) | `BREAK` `AND` `ADDCOMM` `ADDBASE` `ADDCOL` `ADDROW` `score_9` ... | Keywords color | `#dcdcaa` |
| Curly brackets | `{ }` | curly brackets color | `#ffd700` |
| Round brackets | `( )` | round brackets color | `#da70d6` |
| Square brackets | `[ ]` | square brackets color | `#179fff` |
| Angle brackets, the text between them has the same color | `<lora:name:0.8>` | angle brackets color | `#4ec9b0` |
| Pipe inside curly brackets | `{a\|b}` | pipe color | `#c586c0` |
| Style variables, the `$` and the name | `$style` `$1style` `$(my style)` `${name=value}` | Dollar color | `#9cdcfe` |
| Dynamic Prompts wrap command, up to the closing `}` | `%{ ... }` | percent color | `#569cd6` |
| Weights, a colon with a number | `:1.2` | weight color | `#da70d6` |
| Comments until the end of the line, or over several lines | `# ...` `// ...` `/* ... */` | comments color | `#6a9955` |
| Wildcards, from the first `__` to the next `__` | `__name__` | wildcard color | `#ce9178` |
| Errors (see below) | | bracket unbalanced color | `#ff1212` |
| Start of a block of 75 tokens | a line over the text | Chunk block line color | `#ff9900` |
| Bracket pair at the cursor | a frame | Bracket pair highlight color | `#ffffff` |

A backslash in front of a character (for example `\(`) means normal text, it is not colored.

### Errors (bracket unbalanced color)

The "bracket unbalanced color" is used for several mistakes:

- a bracket that has no partner (an opening bracket without a closing one, or the other way round, or a wrong type like `(a]`)
- a pipe `|` outside of curly brackets
- empty commas: a comma that has only spaces between it and the comma before it, like `,,` or `, ,`. The first comma stays normal, only the following ones are colored (`a,, b` -> the second comma, `a , , , b` -> the last two)
- spaces at the end of a line (also at the end of the whole text): they get the color as **background**. Spaces inside a line are never marked. The spaces of the line where the cursor is are not marked, because you are probably still typing there. When the cursor leaves the line, they are marked.

### Bracket pair highlight

When the cursor is directly before or after a bracket `{}` `[]` `()` `<>`, this bracket and its partner get a frame. Nested brackets work: the pair of the bracket next to the cursor is shown. Brackets without a partner are not highlighted. Set the color in "Bracket pair highlight color" (empty or invalid = off).

### Blocks of 75 tokens

A horizontal line is shown over the text line where a new block of 75 tokens starts (the size of a CLIP block). The tokens are counted by the server, see `scripts/prompt_colors_chunks.py`, with the tokenizer of the loaded model. The block size can be changed in "Tokens per chunk block" (0 = off). "Chunk block line color" empty or invalid = off.

### Autocomplete order after `<`

If the extension TagComplete is installed: after typing `<` all LoRA entries are listed first in the suggestion list.

### Other settings

- **Keywords**: the words that get the keyword color, separated by commas.
- **Response delay in ms**: how often the prompt boxes are checked for text that a program changed (paste, autocomplete). 0 = off, default 300. Typing is always shown immediately.
