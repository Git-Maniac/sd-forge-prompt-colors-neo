// Prompt Colors: colors special characters and words in the prompt fields.
//
// WHAT IS COLORED
//   { } ( ) [ ] < >   brackets (each type has its own color, the text between < > too)
//   |                 the pipe
//   %{ ... }          a Dynamic Prompts wrap command: everything up to the } gets one color
//   $style            a style variable: the $ and the style name get the same color
//   ${name=value}     a Dynamic Prompts variable: everything up to the } gets the same color
//   :1.2              a colon with a number behind it (weights)
//   BREAK, AND, ...   keywords (the list is in the settings)
//   __name__          wildcards (from the first __ to the next __)
//   # ... and // ...  comment until the end of the line
//   /* ... */         comment (can be over several lines)
//
// WHERE THE COLORS ARE SET
//   In the WebUI:  Settings -> Extensions -> Prompt Colors
//   (the default colors are in scripts/prompt_colors_settings.py)
//
// HOW IT WORKS
//   A text field cannot show colored text. So a second element (the "backdrop")
//   is placed behind the field. It shows the same text, but with colored
//   characters. The text of the real field is made invisible, only the cursor
//   and the selection stay visible.
//
// THE PARTS OF THIS FILE
//   1. Fixed values       lists and names that never change
//   2. Small helpers      tiny functions that are used in many places
//   3. Colors             writes the colors from the settings into the page (css)
//   4. Find the colors    decides which character gets which color
//   5. Make the html      turns the text and the colors into html for the backdrop
//   6. The backdrop       puts the backdrop behind a prompt field and keeps it up to date
//   7. The timer          checks the fields now and then
//   8. The settings page  colors the color fields of the settings page
//   9. Start              what runs when the page is loaded

(function () {

    // ===============================================================
    // 1. Fixed values
    // ===============================================================

    // the prompt fields that get colored (ids in the WebUI)
    const FIELD_IDS = [
        "txt2img_prompt", "txt2img_neg_prompt",
        "img2img_prompt", "img2img_neg_prompt",
        "hires_prompt", "hires_neg_prompt",
    ];

    // names of the colors (same names as in scripts/prompt_colors_settings.py)
    const COLOR_NAMES = ["curly", "round", "square", "angle", "pipe", "dollar", "percent", "comment", "wildcard", "keyword", "weight", "error"];

    // characters that stand alone and need no partner: character -> color name
    // ($ and % are not here: they are handled together with the text behind them)
    const SINGLE = { "|": "pipe" };

    // a style name behind a $ ends at a space or at one of these characters
    const STYLE_END_CHARS = " \t\n\r,|$[](){}<>:";

    // opening brackets: character -> color name
    const OPENING = { "{": "curly", "(": "round", "[": "square", "<": "angle" };

    // closing brackets: character -> the opening bracket that belongs to it
    const CLOSING = { "}": "{", ")": "(", "]": "[", ">": "<" };

    // letters, digits and _  (to find out if a keyword is a whole word)
    const WORD_CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_";

    // the backdrop must look exactly like the field, so these styles are copied from the field
    const COPIED_STYLES = [
        "fontFamily", "fontSize", "fontWeight", "fontStyle", "lineHeight", "letterSpacing",
        "wordSpacing", "textIndent", "tabSize", "textTransform",
        "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "borderRadius",
    ];


    // ===============================================================
    // 2. Small helpers
    // ===============================================================

    // the page of the WebUI (all fields are searched in here)
    function getRoot() {
        if (typeof gradioApp === "function") {
            return gradioApp();
        }
        return document;
    }

    // the text of the keywords setting, for example "BREAK, AND, ADDCOMM"
    function getKeywordSetting() {
        if (typeof opts === "undefined") {
            return "";    // the settings are not loaded yet
        }
        return String(opts.prompt_colors_keywords || "");
    }

    // the keywords as a list, for example ["BREAK", "AND", "ADDCOMM"]
    function getKeywords() {
        const keywords = [];
        const words = getKeywordSetting().split(",");    // cut the text at every comma

        for (const word of words) {
            const clean = word.trim();    // remove the spaces around the word
            if (clean !== "") {
                keywords.push(clean);     // empty entries are skipped
            }
        }
        return keywords;
    }

    // is this character a letter, a digit or _ ?
    // (for a position outside of the text the character is "undefined", that is no letter)
    function isWordChar(ch) {
        if (ch === undefined) {
            return false;
        }
        return WORD_CHARS.includes(ch);
    }

    // html needs a replacement for these three characters, otherwise they are taken as html code
    function escapeChar(ch) {
        if (ch === "&") return "&amp;";
        if (ch === "<") return "&lt;";
        if (ch === ">") return "&gt;";
        return ch;
    }

    // the same for a whole text
    function escapeText(text) {
        let result = "";
        for (const ch of text) {
            result += escapeChar(ch);
        }
        return result;
    }

    // gives the characters from position "from" to position "to" (both included) a color
    // colorOf is the list with one color name for every character of the text
    function paint(colorOf, from, to, colorName) {
        for (let k = from; k <= to; k++) {
            colorOf[k] = colorName;
        }
    }

    // "openPosition" is the position of a { in the text. This returns the position of the }
    // that closes it, or -1 if there is none.
    // Curly brackets can be nested, like {a={x|y}}, so we count:
    // every { adds one, every } removes one, when the count is zero we are at the end.
    function findClosingBrace(text, openPosition) {
        let depth = 0;
        for (let k = openPosition; k < text.length; k++) {
            if (text[k] === "{") {
                depth++;
            }
            if (text[k] === "}") {
                depth--;
                if (depth === 0) {
                    return k;
                }
            }
        }
        return -1;
    }

    // if a number (like 1.2, .5 or -0.3) starts at position "start", this returns the position
    // right behind the number. If there is no number it returns -1.
    function findNumberEnd(text, start) {
        let end = start;

        if (text[end] === "-") {
            end++;    // a negative number
        }

        let hasDigit = false;
        // go on as long as there are digits or a dot
        while (text[end] !== undefined && "0123456789.".includes(text[end])) {
            if (text[end] !== ".") {
                hasDigit = true;
            }
            end++;
        }

        // only dots (or nothing at all) is not a number
        if (hasDigit) {
            return end;
        }
        return -1;
    }


    // ===============================================================
    // 3. Colors: writes the colors from the settings into the page
    // ===============================================================

    // the colors are written as css into a <style> element, one line per color, for example:
    //     .pc-curly { color: #ffd700; }
    // Later every colored character gets the class "pc-curly" (see part 5).
    function applyColors() {
        if (typeof opts === "undefined") {
            return;    // the settings are not loaded yet
        }

        // css for the field and the backdrop behind it
        let css = `
            .pc-field { background: transparent !important; -webkit-text-fill-color: transparent; position: relative; z-index: 1; }
            .pc-backdrop { position: absolute; overflow: hidden; pointer-events: none; z-index: 0;
                           white-space: pre-wrap; overflow-wrap: break-word; background: var(--input-background-fill, transparent); }
        `;

        // one css line per color
        // (no bold: bold letters are wider, then the text would no longer fit the field)
        for (const name of COLOR_NAMES) {
            const value = String(opts["prompt_colors_" + name] || "").trim();

            // empty or not a valid color: no css line, so these characters are not colored
            if (value === "" || !CSS.supports("color", value)) {
                continue;
            }

            css += `.pc-${name} { color: ${value}; }\n`;
        }

        // put the css into a <style> element (it is created the first time)
        let style = document.getElementById("prompt-colors-style");
        if (!style) {
            style = document.createElement("style");
            style.id = "prompt-colors-style";
            document.head.appendChild(style);
        }
        style.textContent = css;
    }


    // ===============================================================
    // 4. Find the colors
    // ===============================================================
    //
    // findColors() looks at the text from left to right, character by character.
    // At every position it tries the rules one after the other (comment, wildcard, ...).
    // Every rule is a small function:
    //   - it checks if its thing starts at this position,
    //   - if yes: it colors the characters and returns HOW MANY characters it colored,
    //   - if no: it returns 0, then the next rule is tried.

    // rule: a comment with # or // until the end of the line
    function colorLineComment(text, i, colorOf) {
        const startsWithHash = text[i] === "#";
        const startsWithSlashes = text[i] === "/" && text[i + 1] === "/";
        if (!startsWithHash && !startsWithSlashes) {
            return 0;
        }

        // the comment ends before the next new line (or at the end of the text)
        let lineEnd = text.indexOf("\n", i);
        if (lineEnd === -1) {
            lineEnd = text.length;
        }

        paint(colorOf, i, lineEnd - 1, "comment");
        return lineEnd - i;
    }

    // rule: a comment from /* to */ (can be over several lines)
    function colorBlockComment(text, i, colorOf) {
        if (text[i] !== "/" || text[i + 1] !== "*") {
            return 0;
        }

        // position of the next */ (a /* without a */ is not a comment)
        const end = text.indexOf("*/", i + 2);
        if (end === -1) {
            return 0;
        }

        paint(colorOf, i, end + 1, "comment");    // end + 1 is the position of the "/" of "*/"
        return end + 2 - i;
    }

    // rule: a wildcard from the first __ to the next __ (in the same line)
    function colorWildcard(text, i, colorOf) {
        if (text[i] !== "_" || text[i + 1] !== "_") {
            return 0;
        }

        const end = text.indexOf("__", i + 2);    // position of the next __
        if (end === -1 || end === i + 2) {
            return 0;    // no closing __, or nothing between the __ and the __
        }

        // is there a new line between the two __ ?
        const lineEnd = text.indexOf("\n", i);
        if (lineEnd !== -1 && lineEnd < end) {
            return 0;
        }

        paint(colorOf, i, end + 1, "wildcard");
        return end + 2 - i;
    }

    // rule: a keyword like BREAK or AND
    function colorKeyword(text, i, colorOf, keywords) {
        for (const word of keywords) {
            const startsHere = text.startsWith(word, i);                 // the text has this word at position i
            const wordBegins = !isWordChar(text[i - 1]);                 // not a letter before it: "XAND" is not "AND"
            const wordEnds = !isWordChar(text[i + word.length]);         // not a letter behind it: "ANDY" is not "AND"

            if (startsHere && wordBegins && wordEnds) {
                paint(colorOf, i, i + word.length - 1, "keyword");
                return word.length;
            }
        }
        return 0;
    }

    // rule: a colon with a number behind it, for example :1.2 in (word:1.2)
    function colorWeight(text, i, colorOf) {
        if (text[i] !== ":") {
            return 0;
        }

        // spaces after the colon are allowed
        let numberStart = i + 1;
        while (text[numberStart] === " ") {
            numberStart++;
        }

        const numberEnd = findNumberEnd(text, numberStart);
        if (numberEnd === -1) {
            return 0;    // a colon without a number is normal text
        }

        paint(colorOf, i, numberEnd - 1, "weight");    // the colon, the spaces and the number
        return numberEnd - i;
    }

    // rule: a style variable: the $ and the style name behind it get the same color
    //   $style          the name ends at a space, a comma, a bracket, ...
    //   $(my style)     with spaces in the name: the name is in round brackets
    //   $1style         a part of a style (the number is part of the name)
    //   ${name=value}   a Dynamic Prompts variable, everything up to the } is colored
    function colorStyleVariable(text, i, colorOf) {
        if (text[i] !== "$") {
            return 0;
        }

        // $$ belongs to Dynamic Prompts (for example {2$$a|b}), there is no style name:
        // only the dollar sign is colored
        if (text[i + 1] === "$" || text[i - 1] === "$") {
            colorOf[i] = "dollar";
            return 1;
        }

        // ${name=value} or ${name} (a Dynamic Prompts variable): color everything up to the
        // closing curly bracket
        if (text[i + 1] === "{") {
            const close = findClosingBrace(text, i + 1);
            if (close !== -1) {
                paint(colorOf, i, close, "dollar");
                return close + 1 - i;
            }
            colorOf[i] = "dollar";    // no closing bracket: only the dollar sign
            return 1;
        }

        // a part number behind the $ (the 1 in $1style or $1(my style)) belongs to the name
        let nameStart = i + 1;
        while (text[nameStart] !== undefined && "0123456789".includes(text[nameStart])) {
            nameStart++;
        }

        // $(my style) or $1(my style): color everything up to the closing bracket (in the same line)
        if (text[nameStart] === "(") {
            const close = text.indexOf(")", nameStart + 1);
            const lineEnd = text.indexOf("\n", i);
            const sameLine = lineEnd === -1 || close < lineEnd;
            if (close !== -1 && sameLine) {
                paint(colorOf, i, close, "dollar");
                return close + 1 - i;
            }
            colorOf[i] = "dollar";    // no closing bracket: only the dollar sign
            return 1;
        }

        // $style: go on until the name ends
        let end = i + 1;
        while (text[end] !== undefined && !STYLE_END_CHARS.includes(text[end])) {
            end++;
        }

        paint(colorOf, i, end - 1, "dollar");    // the dollar sign and the name
        return end - i;
    }

    // rule: a Dynamic Prompts wrap command  %{ ... }  : everything up to the closing curly bracket
    // is colored. A % without a { behind it is normal text.
    function colorWrapCommand(text, i, colorOf) {
        if (text[i] !== "%" || text[i + 1] !== "{") {
            return 0;
        }

        const close = findClosingBrace(text, i + 1);
        if (close === -1) {
            return 0;    // no closing bracket: not colored
        }

        paint(colorOf, i, close, "percent");
        return close + 1 - i;
    }

    // rule: the single character  |
    function colorSingleChar(text, i, colorOf) {
        const colorName = SINGLE[text[i]];
        if (colorName === undefined) {
            return 0;
        }

        colorOf[i] = colorName;
        return 1;
    }

    // rule: brackets
    // "waiting" is the list of opening brackets that still wait for their closing bracket
    // (it is a list of positions, the last one is the bracket that must be closed first)
    function colorBracket(text, i, colorOf, waiting) {
        const ch = text[i];

        if (OPENING[ch] !== undefined) {
            // an opening bracket: remember its position and color it red for now
            // (it gets its real color when the closing bracket is found)
            waiting.push(i);
            colorOf[i] = "error";
            return 1;
        }

        if (CLOSING[ch] !== undefined) {
            // a closing bracket: does it fit to the last opening bracket that is waiting?
            const openPosition = waiting[waiting.length - 1];    // undefined if nothing is waiting
            const fits = openPosition !== undefined && text[openPosition] === CLOSING[ch];

            if (fits) {
                waiting.pop();    // this opening bracket is done
                const colorName = OPENING[text[openPosition]];
                colorOf[openPosition] = colorName;
                colorOf[i] = colorName;

                // < > : the text between the brackets gets the same color,
                // for example the whole <lora:name:0.8> (this replaces the colors inside)
                if (text[openPosition] === "<") {
                    paint(colorOf, openPosition, i, "angle");
                }
            } else {
                colorOf[i] = "error";    // this closing bracket has no partner
            }
            return 1;
        }

        return 0;
    }

    // returns a list with one color name for every character of the text
    // (null means: normal text, no color)
    function findColors(text) {
        const colorOf = new Array(text.length).fill(null);    // a list of the same length as the text, filled with null
        const keywords = getKeywords();
        const waiting = [];    // positions of opening brackets that wait for their closing bracket

        let i = 0;    // the position in the text
        while (i < text.length) {

            // try the rules one after the other, the first one that fits colors the characters
            let length = colorLineComment(text, i, colorOf);
            if (length === 0) length = colorBlockComment(text, i, colorOf);
            if (length === 0) length = colorWildcard(text, i, colorOf);
            if (length === 0) length = colorKeyword(text, i, colorOf, keywords);

            // a backslash in front means: normal text, for example \(
            // so the next rules are skipped
            const hasBackslash = text[i - 1] === "\\";
            if (length === 0 && !hasBackslash) length = colorWeight(text, i, colorOf);
            if (length === 0 && !hasBackslash) length = colorStyleVariable(text, i, colorOf);
            if (length === 0 && !hasBackslash) length = colorWrapCommand(text, i, colorOf);
            if (length === 0 && !hasBackslash) length = colorSingleChar(text, i, colorOf);
            if (length === 0 && !hasBackslash) length = colorBracket(text, i, colorOf, waiting);

            // go on behind the characters that were colored (if no rule fit: go one character on)
            if (length === 0) {
                i = i + 1;
            } else {
                i = i + length;
            }
        }

        return colorOf;
    }


    // ===============================================================
    // 5. Make the html
    // ===============================================================

    // turns the text and its colors into html for the backdrop, for example:
    //     a <span class="pc-curly">{</span>b<span class="pc-curly">}</span>
    function makeHtml(text, colorOf) {
        let html = "";

        // Characters in a row with the same color share ONE <span>  (fewer elements = faster page)
        // "start" is the first character of the current group
        let start = 0;
        while (start < text.length) {
            const color = colorOf[start];

            // find the last character of the group (the last one with the same color)
            let end = start;
            while (end + 1 < text.length && colorOf[end + 1] === color) {
                end++;
            }

            const piece = escapeText(text.slice(start, end + 1));    // the text of the group
            if (color) {
                html += `<span class="pc-${color}">${piece}</span>`;
            } else {
                html += piece;
            }

            start = end + 1;    // the next group starts behind this one
        }

        // one extra space, so an empty last line has the same height as in the field
        return html + " ";
    }

    // the two steps together: text in, html out
    function buildHtml(text) {
        return makeHtml(text, findColors(text));
    }


    // ===============================================================
    // 6. The backdrop behind a prompt field
    // ===============================================================

    // All prompt fields that already have a backdrop. Every entry has these values:
    //   textarea      the real prompt field
    //   backdrop      the element behind it
    //   lastText      the text that the backdrop shows right now
    //   lastKeywords  the keywords that were used for it
    //   waiting       true if an update is already planned
    const fields = [];

    // puts the backdrop exactly behind the field (place, size, font)
    // This is the slow part (the browser must calculate the layout), so it only runs
    // when the field is created, when it gets another size, or when it gets the focus.
    function updateLook(field) {
        const textarea = field.textarea;
        const backdrop = field.backdrop;
        const style = getComputedStyle(textarea);    // the styles that the browser really uses for the field

        // same place and size as the inside of the field (without border and scrollbar)
        backdrop.style.left = (textarea.offsetLeft + textarea.clientLeft) + "px";
        backdrop.style.top = (textarea.offsetTop + textarea.clientTop) + "px";
        backdrop.style.width = textarea.clientWidth + "px";
        backdrop.style.height = textarea.clientHeight + "px";

        // same font and spacing as the field
        backdrop.style.color = style.color;
        for (const name of COPIED_STYLES) {
            backdrop.style[name] = style[name];
        }
    }

    // scrolls the backdrop like the field
    function syncScroll(field) {
        field.backdrop.scrollTop = field.textarea.scrollTop;
        field.backdrop.scrollLeft = field.textarea.scrollLeft;
    }

    // shows the current text of the field in the backdrop
    // (only if the text or the keywords changed, otherwise nothing is built again)
    function updateText(field) {
        const text = field.textarea.value;
        const keywords = getKeywordSetting();

        if (text !== field.lastText || keywords !== field.lastKeywords) {
            field.lastText = text;
            field.lastKeywords = keywords;
            field.backdrop.innerHTML = buildHtml(text);
        }
        syncScroll(field);
    }

    // does updateText() soon, but only ONCE per screen update
    // (typing fast, paste and autocomplete can send many events, one update is enough)
    function scheduleText(field) {
        if (field.waiting) {
            return;    // an update is already planned
        }
        field.waiting = true;

        // requestAnimationFrame: the browser runs the function right before it draws the next picture
        requestAnimationFrame(function () {
            field.waiting = false;
            updateText(field);
        });
    }

    // adds a backdrop to one prompt field
    function attach(textarea) {
        textarea.classList.add("pc-field");

        // the backdrop is placed relative to the parent element of the field
        const parent = textarea.parentElement;
        if (getComputedStyle(parent).position === "static") {
            parent.style.position = "relative";
        }

        // create the backdrop and put it in front of the field in the page
        const backdrop = document.createElement("div");
        backdrop.className = "pc-backdrop";
        parent.insertBefore(backdrop, textarea);

        // remember everything that belongs to this field
        const field = { textarea: textarea, backdrop: backdrop, lastText: null, lastKeywords: null, waiting: false };
        fields.push(field);

        // when typing: show the new text
        textarea.addEventListener("input", function () {
            scheduleText(field);
        });

        // when scrolling: scroll the backdrop too
        textarea.addEventListener("scroll", function () {
            syncScroll(field);
        });

        // when the field gets the focus: make sure the backdrop is in the right place
        textarea.addEventListener("focus", function () {
            updateLook(field);
        });

        // when the field (or the box around it) gets another size, the backdrop must follow
        const resizeObserver = new ResizeObserver(function () {
            updateLook(field);
        });
        resizeObserver.observe(textarea);
        resizeObserver.observe(parent);

        // first time: place the backdrop and show the text
        updateLook(field);
        updateText(field);
    }


    // ===============================================================
    // 7. The timer
    // ===============================================================

    // the time between two checks, in milliseconds, from the settings
    // 0 means: the timer is off (also if the setting is empty or not a number)
    function getTimerMs() {
        if (typeof opts === "undefined") {
            return 0;    // the settings are not loaded yet
        }

        const ms = Number(opts.prompt_colors_timer);
        if (!(ms > 0)) {
            return 0;    // not a number, or 0 or less
        }

        return Math.max(ms, 50);    // faster than every 50 ms makes no sense
    }

    // The timer checks all fields. It is only for text that a program changed without
    // an "input" event (paste, autocomplete). It only compares texts, which is fast.
    function checkFields() {
        if (getTimerMs() > 0) {
            for (const field of fields) {
                const textChanged = field.textarea.value !== field.lastText;
                const keywordsChanged = getKeywordSetting() !== field.lastKeywords;
                if (textChanged || keywordsChanged) {
                    scheduleText(field);
                }
            }
        }

        // check again later
        // (when the timer is off we only look every second if the setting was changed)
        let wait = getTimerMs();
        if (wait === 0) {
            wait = 1000;
        }
        setTimeout(checkFields, wait);
    }


    // ===============================================================
    // 8. The color fields on the settings page
    // ===============================================================

    // colors one field of the settings page with the color that is written in it
    function paintSettingField(name) {
        const field = getRoot().querySelector(`#setting_prompt_colors_${name} input, #setting_prompt_colors_${name} textarea`);
        if (!field) {
            return;    // the settings page is not there
        }

        // paint again whenever something is typed into the field (this is added only once)
        if (!field.dataset.promptColorsPaint) {
            field.dataset.promptColorsPaint = "1";
            field.addEventListener("input", function () {
                paintSettingField(name);
            });
        }

        const value = field.value.trim();

        // is the text a valid color, for example #ff8800 ?
        if (value !== "" && CSS.supports("color", value)) {
            field.style.backgroundColor = value;

            // the browser tells us the color as "rgb(220, 220, 170)", cut it into the 3 numbers
            const rgb = getComputedStyle(field).backgroundColor;
            const parts = rgb.replace("rgba(", "").replace("rgb(", "").replace(")", "").split(",");
            const red = Number(parts[0]);
            const green = Number(parts[1]);
            const blue = Number(parts[2]);

            // how bright is the color? 0 = black ... 255 = white
            const brightness = (red * 299 + green * 587 + blue * 114) / 1000;

            // dark color: white text, bright color: black text
            if (brightness > 140) {
                field.style.color = "black";
            } else {
                field.style.color = "white";
            }
        } else {
            // not a color: the field looks normal
            field.style.backgroundColor = "";
            field.style.color = "";
        }
    }


    // ===============================================================
    // 9. Start
    // ===============================================================

    // ids of the prompt fields that already have a backdrop
    const doneIds = [];

    // runs shortly after the page changed (fields can appear later, for example the settings page)
    function onUpdate() {
        // color the fields of the settings page (only if this page exists)
        if (getRoot().querySelector("#column_settings_prompt_colors")) {
            for (const name of COLOR_NAMES) {
                paintSettingField(name);
            }
        }

        // add a backdrop to the prompt fields that have none yet
        for (const id of FIELD_IDS) {
            if (doneIds.includes(id)) {
                continue;    // this field is done, no search needed
            }

            const textarea = getRoot().querySelector(`#${id} textarea`);
            if (textarea) {
                attach(textarea);
                doneIds.push(id);
            }
        }
    }

    // 1. write the colors into the page
    applyColors();

    // 2. write them again when the settings are loaded or changed ("Apply settings")
    onOptionsChanged(applyColors);

    // 3. look for the prompt fields now and after every change of the page
    //    (onAfterUiUpdate runs 250 ms after the changes, not at every single change)
    onAfterUiUpdate(onUpdate);

    // 4. start the timer
    checkFields();
})();
