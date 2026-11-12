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

# ---- pixel wordmark "just-Code" in the style of the logo's J ----
G = {
 "j": ["....#", ".....", "...##", "....#", "....#", "....#", "....#", "#...#", ".###."],
 "u": [".....", ".....", "#...#", "#...#", "#...#", "#..##", ".##.#", ".....", "....."],
 "s": [".....", ".....", ".####", "#....", ".###.", "....#", "####.", ".....", "....."],
 "t": [".#...", ".#...", "####.", ".#...", ".#...", ".#..#", "..##.", ".....", "....."],
 "-": [".....", ".....", ".....", ".....", "###..", ".....", ".....", ".....", "....."],
 "C": [".###.", "#...#", "#....", "#....", "#....", "#...#", ".###.", ".....", "....."],
 "o": [".....", ".....", ".###.", "#...#", "#...#", "#...#", ".###.", ".....", "....."],
 "d": ["....#", "....#", ".####", "#...#", "#...#", "#...#", ".####", ".....", "....."],
 "e": [".....", ".....", ".###.", "#...#", "#####", "#....", ".###.", ".....", "....."],
}
WIDTH = {"-": 3}
rects, x = [], 0
for ch in "just-Code":
    g = G[ch]
    for y, row in enumerate(g):
        for dx, px in enumerate(row):
            if px == "#":
                rects.append(f'<rect x="{x + dx}" y="{y}" width="1" height="1"/>')
    x += WIDTH.get(ch, 5) + 1
cursor = f'<rect class="cur" x="{x}" y="0" width="3" height="7"/>'
w = x + 3
svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} 9" shape-rendering="crispEdges" role="img" aria-label="just-Code">'
       f'<g class="ink">{"".join(rects)}</g>{cursor}</svg>')
svg = svg.replace("<svg ", '<svg class="wordmark" ', 1)
idx = PUB / "index.html"
page = idx.read_text()
page = re.sub(r"<!--wordmark-->.*?<!--/wordmark-->", lambda _: f"<!--wordmark-->{svg}<!--/wordmark-->", page, flags=re.S)
idx.write_text(page)
print("frames:", len(data["session"]), "turbo:", len(data["turbo"]), "wordmark width:", w)
