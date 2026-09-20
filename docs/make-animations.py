# Generates the README's animated SVGs (vector, looping, light and dark):
#   docs/extract-{light,dark}.svg   fields being picked out of a message
#   docs/pii-{light,dark}.svg       the PII threshold slider re-filtering one scan
# Run: python3 docs/make-animations.py     The PII scores are from a real scan of this text.
# With "reduce motion" on, the fades still play (fades are what that setting allows) and the
# slider moves in steps instead of gliding.
from html import escape
W = 860
MONO = "ui-monospace,SFMono-Regular,'SF Mono',Menlo,Consolas,monospace"
SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI','Noto Sans',Helvetica,Arial,sans-serif"
THEMES = {
  'light': dict(ink='#1c2544', muted='#626d85', line='#d0d7e6', chip='#f6f8fc', panel='#ffffff', track='#d8dfed',
                tones=[('#244bd8', '#e6ecff'), ('#0b7a53', '#def5ea'), ('#a1490a', '#fdebd8'), ('#8a2d9c', '#f5e3f9')]),
  'dark':  dict(ink='#e6edf3', muted='#8b949e', line='#30363d', chip='#161b22', panel='#0d1117', track='#30363d',
                tones=[('#7c9cff', '#1b2547'), ('#56d364', '#12301f'), ('#f0a35e', '#3a2412'), ('#d38cf0', '#2f1a38')]),
}
# ---- motion: nothing moves at constant speed ----
EASE = (0.5, 0, 0.15, 1)                                  # quick start, soft landing
def bezier_y(x, c=EASE):
    """y of a CSS cubic-bezier timing function at progress x (solved numerically)."""
    x1, y1, x2, y2 = c
    lo, hi = 0.0, 1.0
    for _ in range(40):
        u = (lo + hi) / 2
        bx = 3 * (1 - u) ** 2 * u * x1 + 3 * (1 - u) * u ** 2 * x2 + u ** 3
        lo, hi = (u, hi) if bx < x else (lo, u)
    u = (lo + hi) / 2
    return 3 * (1 - u) ** 2 * u * y1 + 3 * (1 - u) * u ** 2 * y2 + u ** 3

def position(stops, pct):
    """Value at loop percent `pct` for stops [(pct, value), ...], eased between stops."""
    for (p0, v0), (p1, v1) in zip(stops, stops[1:]):
        if p0 <= pct <= p1:
            return v0 if v0 == v1 or p1 == p0 else v0 + (v1 - v0) * bezier_y((pct - p0) / (p1 - p0))
    return stops[-1][1]

def on_off_keyframes(name, is_on, samples=2400):
    """Hard-cut visibility keyframes from a predicate over loop percent."""
    frames, prev = [], None
    for i in range(samples + 1):
        pct = 100 * i / samples
        state = bool(is_on(pct))
        if state != prev:
            if prev is not None: frames.append((max(pct - 100 / samples, 0), prev))
            frames.append((pct, state)); prev = state
    frames.append((100, prev))
    body = ''.join(f'{p:.3f}%{{opacity:{1 if on else 0}}}' for p, on in frames)
    return f'@keyframes {name}{{{body}}}'

def text(x, y, s, size=14, fill='#000', font=SANS, weight=400, anchor='start', extra=''):
    return f'<text x="{x:.1f}" y="{y}" font-family="{font}" font-size="{size}" font-weight="{weight}" fill="{fill}" text-anchor="{anchor}"{extra}>{escape(s)}</text>'

def extract(t):
    CH, LOOP = 8.43, 12
    tokens = ['Hi', ',', "I'm", 'Maya', 'Chen', 'from', 'Fern', 'Labs', '.', 'Reach', 'me', 'at', 'maya', '@', 'fern', '.', 'example']
    # field, token range, value, offsets, probability  (from a real run on this sentence)
    fields = [('name', 3, 4, "'Maya Chen'", '[8, 17)', '98%'), ('company', 6, 7, "'Fern Labs'", '[23, 32)', '98%'),
              ('email', 12, 16, "'maya@fern.example'", '[46, 63)', '98%'), ('phone', None, None, 'not in the text', '', '')]
    o, css, xs, x = [], [], [], 24
    for tok in tokens:
        w = len(tok) * CH + 14; xs.append((x, w)); x += w + 5
    o.append(text(24, 24, 'Each word of the message is numbered', 13, t['muted']))
    for i, (tok, (cx, w)) in enumerate(zip(tokens, xs)):
        o.append(f'<rect x="{cx:.1f}" y="36" width="{w:.1f}" height="46" rx="8" fill="{t["chip"]}" stroke="{t["line"]}"/>')
    for n, (name, lo, hi, value, offsets, prob) in enumerate(fields):
        stroke, fill = t['tones'][n]
        start = 8 + n * 9                        # percent of the loop: answers land about a second apart, then hold
        css.append(f'@keyframes f{n}{{0%,{start}%{{opacity:0;transform:scale(.92)}}{start+.01}%{{opacity:1;transform:scale(.92)}}{start+1.2}%{{transform:scale(1.04)}}{start+2.4}%,94%{{opacity:1;transform:scale(1)}}96%,100%{{opacity:0;transform:scale(1)}}}}'
                   f'.f{n}{{opacity:0;transform-box:fill-box;transform-origin:center;animation:f{n} {LOOP}s cubic-bezier(.3,1.4,.5,1) infinite}}')
        if lo is not None:
            x0, x1 = xs[lo][0], xs[hi][0] + xs[hi][1]
            o.append(f'<g class="f{n}"><rect x="{x0-2:.1f}" y="34" width="{x1-x0+4:.1f}" height="50" rx="10" fill="{fill}" stroke="{stroke}" stroke-width="2"/>'
                     + text((x0 + x1) / 2, 102, f'{name} → {lo}–{hi}', 12, stroke, SANS, 650, 'middle') + '</g>')
        y = 150 + n * 30
        row = text(24, y, name, 15, stroke, SANS, 650) + text(110, y, value, 15, t['ink'] if lo is not None else t['muted'], MONO if lo is not None else SANS)
        if lo is not None: row += text(360, y, offsets, 13, t['muted'], MONO) + text(450, y, prob, 13, t['muted'], SANS)
        o.append(f'<g class="f{n}">{row}</g>')
    for i, (tok, (cx, w)) in enumerate(zip(tokens, xs)):   # chip text above the highlight fills
        o.append(text(cx + w / 2, 53, str(i), 11, t['muted'], MONO, 400, 'middle') + text(cx + w / 2, 73, tok, 14, t['ink'], MONO, 400, 'middle'))
    o.append(text(24, 282, 'extractSpans({ text, fields })  ·  one request  ·  every value is text.slice(start, end)', 13, t['muted'], MONO))
    return svg(300, 'Animation: four fields are asked for in turn. For each one, the numbered words Jev picked light up and the exact text appears with its offsets. The phone number is reported as not in the text.', css, o)

def pii(t):
    CH, LOOP = 8.43, 12
    lines = ["Alex Smith referred me. I'm Maya Chen, born 09/07/1990. Email maya.chen@example.com or",
             "call +1 (415) 555-0123. My doctor in Seattle is treating my asthma. The meeting is next Tuesday."]
    # (words, tone, real score from a categorized scan); a joined span shows its weakest word's score
    spans = [('Alex Smith', 0, .99), ('Maya Chen', 0, .99), ('09/07/1990', 2, 1.0), ('maya.chen@example.com', 1, 1.0), ('+1 (415) 555-0123', 1, .80),
             ('doctor', 3, .19), ('Seattle', 2, .90), ('my', 3, .12), ('asthma', 3, .98), ('Tuesday', 2, .06), ('treating', 3, .06)]
    LO, HI = .03, .97
    # Loop percent → threshold. It holds at both ends, steps through the low scores, crosses the empty
    # middle (nothing scores between 19% and 80%) in one quick move, and slows again through the high scores.
    STOPS = [(0, .03), (9, .03), (14, .11), (19, .11), (24, .25), (29, .25), (36, .85), (42, .85), (47, .97), (60, .97),
             (68, .25), (73, .25), (79, .03), (100, .03)]
    threshold = lambda pct: position(STOPS, pct)
    o, css = [], []
    o.append(text(24, 24, 'One scan scores every word. The slider only changes which scores count.', 13, t['muted']))
    o.append(f'<rect x="12" y="36" width="{W-24}" height="76" rx="10" fill="{t["panel"]}" stroke="{t["line"]}"/>')
    for n, (words, tone, score) in enumerate(spans):
        li = next(i for i, l in enumerate(lines) if words in l)
        col = lines[li].index(words) if words != 'my' else lines[li].index(' my asthma') + 1
        stroke, fill = t['tones'][tone]
        css.append(on_off_keyframes(f'p{n}', lambda pct, score=score: threshold(pct) <= score) + f'.p{n}{{animation:p{n} {LOOP}s step-end infinite}}')
        o.append(f'<rect class="p{n}" x="{24 + col * CH - 3:.1f}" y="{47 + li * 28}" width="{len(words) * CH + 6:.1f}" height="22" rx="5" fill="{fill}" stroke="{stroke}"/>')
    for li, l in enumerate(lines):
        o.append(text(24, 63 + li * 28, l, 14, t['ink'], MONO, 400, 'start', ' xml:space="preserve"'))
    # slider
    x0, x1, y = 200, W - 90, 150
    o.append(text(24, y + 5, 'Minimum PII probability', 14, t['ink'], SANS, 600))
    o.append(f'<rect x="{x0}" y="{y-3}" width="{x1-x0}" height="6" rx="3" fill="{t["track"]}"/>')
    span = x1 - x0
    frac = lambda v: (v - LO) / (HI - LO)
    knob = ''.join(f'{p}%{{transform:translateX({frac(v) * span:.1f}px)}}' for p, v in STOPS)
    bar = ''.join(f'{p}%{{transform:scaleX({max(frac(v), 0.0001):.4f})}}' for p, v in STOPS)
    timing = f'cubic-bezier({",".join(str(c) for c in EASE)})'
    css.append(f'@keyframes knob{{{knob}}}.knob{{animation:knob {LOOP}s {timing} infinite}}')
    css.append(f'@keyframes fillbar{{{bar}}}.fillbar{{transform-box:fill-box;transform-origin:left center;animation:fillbar {LOOP}s {timing} infinite}}')
    o.append(f'<rect class="fillbar" x="{x0}" y="{y-3}" width="{span}" height="6" rx="3" fill="{t["tones"][0][0]}"/>')
    o.append(f'<circle class="knob" cx="{x0}" cy="{y}" r="10" fill="{t["tones"][0][0]}" stroke="{t["panel"]}" stroke-width="3"/>')
    for k in range(3, 98, 2):                                    # the percentage readout follows the same motion
        css.append(on_off_keyframes(f'v{k}', lambda pct, k=k: k - 1 <= threshold(pct) * 100 < k + 1) + f'.v{k}{{opacity:0;animation:v{k} {LOOP}s step-end infinite}}')
        o.append(f'<g class="v{k}">' + text(W - 24, y + 5, f'{k}%', 15, t['tones'][0][0], SANS, 700, 'end') + '</g>')
    o.append(text(x0, y + 28, 'more possible matches', 12, t['muted']) + text(x1, y + 28, 'stronger matches only', 12, t['muted'], SANS, 400, 'end'))
    o.append(text(24, 212, 'classifyChunks({ text, labels })  ·  one request  ·  re-filtering needs no new request', 13, t['muted'], MONO))
    return svg(228, 'Animation: a threshold slider moves from low to high. Weak matches such as doctor and Tuesday drop out first; names, the email, the date and asthma stay highlighted until the top.', css, o)

def svg(height, label, css, body):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {height}" width="{W}" height="{height}" role="img" aria-label="{escape(label)}">'
            f'<style>{"".join(css)}@media(prefers-reduced-motion:reduce){{.knob,.fillbar{{animation-timing-function:step-end}}}}</style>{"".join(body)}</svg>\n')

for name, theme in THEMES.items():
    open(f'docs/extract-{name}.svg', 'w').write(extract(theme))
    open(f'docs/pii-{name}.svg', 'w').write(pii(theme))
print('ok')
