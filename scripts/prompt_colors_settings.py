# Settings page of the Prompt Colors extension.
# In the WebUI: Settings -> Extensions -> Prompt Colors
#
# Each line is: name, text in the settings (with a fixed hint), color used at the start.
# The hint in the text is NOT changed automatically. If you change a color
# in the third column, change the hint in the second column too (or leave it,
# then it still shows the original color of the extension).

from modules import script_callbacks, shared

# The colors are the ones of Visual Studio Code (theme "Dark+"):
#   brackets {} () []  -> the bracket pair colors (gold, orchid, light blue)
#   comment            -> comment green
#   wildcard           -> string orange
#   $ % | <>           -> variable, keyword, control keyword and type colors
KEYWORDS = "BREAK, AND, ADDCOMM, ADDBASE, ADDCOL, ADDROW, score_9, score_8_up, score_7_up, score_6, score_5, score_4"

# (the layout of the settings page, for example which field is next to which, is in style.css)
COLORS = [
    ("keyword", "Keywords color  (default #dcdcaa)", "#dcdcaa"),
    ("curly", "{ }   curly brackets color  (default #ffd700)", "#ffd700"),
    ("round", "( )   round brackets color  (default #da70d6)", "#da70d6"),
    ("square", "[ ]   square brackets color  (default #179fff)", "#179fff"),
    ("angle", "< >   angle brackets color  (default #4ec9b0)", "#4ec9b0"),
    ("pipe", "|   pipe color  (default #c586c0)", "#c586c0"),
    ("dollar", "$( )   Dollar color  (default #9cdcfe)", "#9cdcfe"),
    ("percent", "%{ }   percent color  (default #569cd6)", "#569cd6"),
    ("weight", ":1.2   weight color  (default #da70d6)", "#da70d6"),
    ("comment", "#  //  /* */   comments color  (default #6a9955)", "#6a9955"),
    ("wildcard", "__name__   wildcard color  (default #ce9178)", "#ce9178"),
    ("error", "bracket unbalanced color  (default #ff1212)", "#ff1212"),
]


def on_ui_settings():
    section = ("prompt_colors", "Prompt Colors")

    # the words that get the "keyword" color, separated by commas
    shared.opts.add_option(
        "prompt_colors_keywords",
        shared.OptionInfo(KEYWORDS, "Keywords  (separated by commas)", section=section),
    )

    for name, label, color in COLORS:
        shared.opts.add_option(
            "prompt_colors_" + name,
            shared.OptionInfo(color, label, section=section),
        )

    # last field: how often the prompt fields are checked for text that a program changed
    # (paste, autocomplete)
    shared.opts.add_option(
        "prompt_colors_timer",
        shared.OptionInfo(300, "Response delay in ms  (0 = off, default 300)", section=section),
    )


script_callbacks.on_ui_settings(on_ui_settings)
