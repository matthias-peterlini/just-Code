"""Turns captured ANSI frames into site/public/frames.js and builds the pixel wordmark SVG."""
import html, json, re, pathlib

HERE = pathlib.Path(__file__).parent
PUB = HERE.parent / "public"
BASIC = {30: "#111", 31: "#c43c2a", 32: "#3a9a5b", 33: "#b8860b", 34: "#3d6fd9", 35: "#a347c9", 36: "#2a9aa8", 37: "#e8e6e1",
         90: "#777", 91: "#ff5a4a", 92: "#4ade80", 93: "#facc15", 94: "#7aa2f7", 95: "#e879f9", 96: "#67e8f9", 97: "#fff"}
SGR = re.compile(r"\x1b\[([0-9;]*)m")


def ansi_to_html(s: str) -> str:
    out, fg, bold, open_ = [], None, False, False
    pos = 0

    def emit(text):
        nonlocal open_
        if not text:
            return
        style = []
        if fg:
            style.append(f"color:{fg}")
        if bold:
            style.append("font-weight:600")
        t = html.escape(text)
        out.append(f'<span style="{";".join(style)}">{t}</span>' if style else t)

    for m in SGR.finditer(s):
        emit(s[pos:m.start()])
        pos = m.end()
        codes = [int(c) for c in m.group(1).split(";") if c] or [0]
        i = 0
        while i < len(codes):
            c = codes[i]
            if c == 0:
                fg, bold = None, False
            elif c == 1:
                bold = True
            elif c == 22:
                bold = False
            elif c == 39:
                fg = None
            elif c == 38 and i + 4 < len(codes) + 1 and codes[i + 1] == 2:
                fg = "#%02x%02x%02x" % tuple(codes[i + 2:i + 5]); i += 4
            elif c in BASIC:
                fg = BASIC[c]
            i += 1
    emit(s[pos:])
    return "".join(out).strip("\n")


frames = json.loads((HERE / "frames.json").read_text())
data = {
    "session": [[ansi_to_html(f["a"]), f["d"]] for f in frames["sessionFrames"]],
    "turbo": [[ansi_to_html(f["a"]), f["d"]] for f in frames["turboFrames"]],
    "permission": ansi_to_html(frames["permission"]),
    "permEdit": ansi_to_html(frames["permEdit"]),
}
(PUB / "frames.js").write_text("window.JC_FRAMES=" + json.dumps(data, ensure_ascii=False) + ";\n")

# ---- pixel wordmark from the shared brand glyphs (src/ui/brand.ts, via dist/) ----
import subprocess
ROOT = HERE.parent.parent
rows = json.loads(subprocess.check_output(
    ["node", "--input-type=module", "-e",
     "const b = await import(process.argv[1]); console.log(JSON.stringify(b.wordmarkRows()))",
     (ROOT / "dist/ui/brand.js").as_uri()]))
ink, cur = [], []
for y, row in enumerate(rows):
    x = 0
    while x < len(row):
        ch = row[x]
        if ch in "#O":
            x0 = x
            while x < len(row) and row[x] == ch:
                x += 1
            (ink if ch == "#" else cur).append(f'<rect x="{x0}" y="{y}" width="{x - x0}" height="1"/>')
        else:
            x += 1
w = len(rows[0])
svg = (f'<svg class="wordmark" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} 7" shape-rendering="crispEdges" role="img" aria-label="just-Code">'
       f'<g class="ink">{"".join(ink)}</g><g class="cur">{"".join(cur)}</g></svg>')
idx = PUB / "index.html"
page = idx.read_text()
page = re.sub(r"<!--wordmark-->.*?<!--/wordmark-->", lambda _: f"<!--wordmark-->{svg}<!--/wordmark-->", page, flags=re.S)
idx.write_text(page)
print("frames:", len(data["session"]), "turbo:", len(data["turbo"]), "wordmark width:", w)
