# Memkin demo — "ask one line, get memory back with sources".
#
# Render:
#   bun scripts/demo-seed.ts          # seed the offline demo library first
#   vhs demo/demo.tape                # writes docs/assets/demo.gif
#
# Records an OFFLINE, deterministic recall against the seeded demo library
# (no embedding API key needed). See demo/demo-query.ts.

Output docs/assets/demo.gif

Set Shell "bash"
Set FontSize 20
Set Width 1200
Set Height 660
Set Padding 24
Set Margin 12
Set MarginFill "#1c1917"
Set Theme { "name": "memkin", "background": "#292524", "foreground": "#e7e5e4", "cursor": "#e07a5f", "black": "#292524", "red": "#e07a5f", "green": "#81b29a", "yellow": "#f2cc8f", "blue": "#8ca5b8", "magenta": "#c9a0dc", "cyan": "#8ca5b8", "white": "#e7e5e4", "brightBlack": "#78716c", "brightRed": "#e07a5f", "brightGreen": "#81b29a", "brightYellow": "#f2cc8f", "brightBlue": "#8ca5b8", "brightMagenta": "#c9a0dc", "brightCyan": "#8ca5b8", "brightWhite": "#fafaf9" }

# --- off-camera setup: alias `memkin` to the offline demo recall, clean the
#     prompt, and pre-print the framing line so frame 0 already carries the
#     question (GitHub shows the first frame as the static, non-autoplay poster).
Hide
Type `alias memkin='bun demo/demo-query.ts 2>/dev/null'`
Enter
Type `clear; PS1='$ '; echo '# Ask your memory a question - memkin answers with sources.'; echo`
Enter
Show

Sleep 1s

# type + run the natural-language question
Type `memkin "What did I discuss with Alice about the launch last week?"`
Sleep 1300ms
Enter
Sleep 2600ms

# hold on the cited answer so a still frame is readable
Sleep 4s
