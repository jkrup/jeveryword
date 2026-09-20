# Generates the README's animated SVGs (vector, looping, light and dark):
#   docs/extract-{light,dark}.svg   fields being picked out of a message
#   docs/pii-{light,dark}.svg       the PII threshold slider re-filtering one scan
# Run: python3 docs/make-animations.py     The PII scores are from a real scan of this text.
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
        start = 6 + n * 21                       # percent of the loop at which this field is answered
        css.append(f'@keyframes f{n}{{0%,{start}%{{opacity:0}}{start+3}%,93%{{opacity:1}}100%{{opacity:0}}}}.f{n}{{opacity:0;animation:f{n} {LOOP}s linear infinite}}')
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
    o, css = [], []
    o.append(text(24, 24, 'One scan scores every word. The slider only changes which scores count.', 13, t['muted']))
    o.append(f'<rect x="12" y="36" width="{W-24}" height="76" rx="10" fill="{t["panel"]}" stroke="{t["line"]}"/>')
    for n, (words, tone, score) in enumerate(spans):
        li = next(i for i, l in enumerate(lines) if words in l)
        col = lines[li].index(words) if words != 'my' else lines[li].index(' my asthma') + 1
        stroke, fill = t['tones'][tone]
        cut = round((score - LO) / (HI - LO) * 50, 2)          # percent of the loop where the threshold passes this score
        cut = min(max(cut, 0.5), 49.5)
        css.append(f'@keyframes p{n}{{0%,{cut-.4}%{{opacity:1}}{cut}%,{100-cut}%{{opacity:0}}{100-cut+.4}%,100%{{opacity:1}}}}.p{n}{{animation:p{n} {LOOP}s linear infinite}}')
        o.append(f'<rect class="p{n}" x="{24 + col * CH - 3:.1f}" y="{47 + li * 28}" width="{len(words) * CH + 6:.1f}" height="22" rx="5" fill="{fill}" stroke="{stroke}"/>')
    for li, l in enumerate(lines):
        o.append(text(24, 63 + li * 28, l, 14, t['ink'], MONO, 400, 'start', ' xml:space="preserve"'))
    # slider
    x0, x1, y = 200, W - 90, 150
    o.append(text(24, y + 5, 'Minimum PII probability', 14, t['ink'], SANS, 600))
    o.append(f'<rect x="{x0}" y="{y-3}" width="{x1-x0}" height="6" rx="3" fill="{t["track"]}"/>')
    css.append(f'@keyframes knob{{0%,100%{{transform:translateX(0)}}50%{{transform:translateX({x1-x0}px)}}}}.knob{{animation:knob {LOOP}s linear infinite}}')
    css.append(f'@keyframes fillbar{{0%,100%{{transform:scaleX(0)}}50%{{transform:scaleX(1)}}}}.fillbar{{transform-box:fill-box;transform-origin:left center;animation:fillbar {LOOP}s linear infinite}}')
    o.append(f'<rect class="fillbar" x="{x0}" y="{y-3}" width="{x1-x0}" height="6" rx="3" fill="{t["tones"][0][0]}"/>')
    o.append(f'<circle class="knob" cx="{x0}" cy="{y}" r="10" fill="{t["tones"][0][0]}" stroke="{t["panel"]}" stroke-width="3"/>')
    steps = 10
    for k in range(steps):                                       # the percentage readout, one label per tenth
        a, b = k * 5, (k + 1) * 5
        css.append(f'@keyframes v{k}{{0%,{a}%{{opacity:0}}{a+.01}%,{b}%{{opacity:1}}{b+.01}%,{100-b}%{{opacity:0}}{100-b+.01}%,{100-a}%{{opacity:1}}{100-a+.01}%,100%{{opacity:0}}}}.v{k}{{opacity:0;animation:v{k} {LOOP}s linear infinite}}')
        o.append(f'<g class="v{k}">' + text(W - 24, y + 5, f'{round((LO + (HI - LO) * (k + .5) / steps) * 100)}%', 15, t['tones'][0][0], SANS, 700, 'end') + '</g>')
    o.append(text(x0, y + 28, 'more possible matches', 12, t['muted']) + text(x1, y + 28, 'stronger matches only', 12, t['muted'], SANS, 400, 'end'))
    o.append(text(24, 212, 'classifyChunks({ text, labels })  ·  one request  ·  re-filtering needs no new request', 13, t['muted'], MONO))
    return svg(228, 'Animation: a threshold slider moves from low to high. Weak matches such as doctor and Tuesday drop out first; names, the email, the date and asthma stay highlighted until the top.', css, o)

def svg(height, label, css, body):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {height}" width="{W}" height="{height}" role="img" aria-label="{escape(label)}">'
            f'<style>{"".join(css)}@media(prefers-reduced-motion:reduce){{*{{animation:none!important}}.f0,.f1,.f2,.f3,.v0{{opacity:1}}.fillbar{{transform:scaleX(0)}}}}</style>{"".join(body)}</svg>\n')

for name, theme in THEMES.items():
    open(f'docs/extract-{name}.svg', 'w').write(extract(theme))
    open(f'docs/pii-{name}.svg', 'w').write(pii(theme))
print('ok')
