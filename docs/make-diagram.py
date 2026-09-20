# Generates docs/how-it-works-{light,dark}.svg. Run: python3 docs/make-diagram.py
from html import escape
W, CH = 860, 8.43  # canvas width; width of one 14px monospace character
MONO = "ui-monospace,SFMono-Regular,'SF Mono',Menlo,Consolas,monospace"
SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI','Noto Sans',Helvetica,Arial,sans-serif"
THEMES = {
  'light': dict(ink='#1c2544', muted='#626d85', line='#d0d7e6', chip='#f6f8fc', accent='#244bd8', soft='#e6ecff', panel='#ffffff', ok='#1a7f4b'),
  'dark':  dict(ink='#e6edf3', muted='#8b949e', line='#30363d', chip='#161b22', accent='#7c9cff', soft='#1b2547', panel='#0d1117', ok='#56d364'),
}
TOKENS = ['Please', 'send', 'the', 'recieved', 'invoices', 'to', 'accounting', 'before', 'Friday', '.']
PICK = 3

def build(t):
    o = []
    text = lambda x, y, s, size=14, fill=t['ink'], font=SANS, weight=400, anchor='start': o.append(
        f'<text x="{x:.1f}" y="{y}" font-family="{font}" font-size="{size}" font-weight="{weight}" fill="{fill}" text-anchor="{anchor}">{escape(s)}</text>')
    step = lambda y, n, title, code: (o.append(f'<circle cx="26" cy="{y-5}" r="12" fill="{t["accent"]}"/>'),
        text(26, y, str(n), 13, t['panel'], SANS, 700, 'middle'), text(48, y, title, 15, t['ink'], SANS, 600),
        text(48 + len(title) * 7.75 + 12, y, code, 13, t['muted'], MONO))

    # 1. tokenize
    step(30, 1, 'Number every word', 'const doc = tokenize(text)')
    x, y = 48, 52
    for i, tok in enumerate(TOKENS):
        w = len(tok) * CH + 20
        on = i == PICK
        o.append(f'<rect x="{x:.1f}" y="{y}" width="{w:.1f}" height="50" rx="8" fill="{t["soft"] if on else t["chip"]}" stroke="{t["accent"] if on else t["line"]}" stroke-width="{2 if on else 1}"/>')
        text(x + w / 2, y + 19, str(i), 12, t['accent'] if on else t['muted'], MONO, 700 if on else 400, 'middle')
        text(x + w / 2, y + 39, tok, 14, t['ink'], MONO, 400, 'middle')
        if on: pick_x = x + w / 2
        x += w + 7

    # 2. the model picks a number
    step(148, 2, 'Jev can only pick an option, so the options are the numbers', '')
    o.append(f'<rect x="48" y="166" width="{W-96}" height="84" rx="10" fill="{t["panel"]}" stroke="{t["line"]}"/>')
    text(66, 193, '“Which token is a misspelled word?”', 15, t['ink'], SANS, 500)
    x = 66
    for label in [str(i) for i in range(len(TOKENS))] + ['none']:
        w = len(label) * CH + 22
        on = label == str(PICK)
        o.append(f'<rect x="{x:.1f}" y="208" width="{w:.1f}" height="28" rx="14" fill="{t["accent"] if on else "none"}" stroke="{t["accent"] if on else t["line"]}"/>')
        text(x + w / 2, 227, label, 13, t['panel'] if on else t['muted'], MONO, 700 if on else 400, 'middle')
        if on: pill_x = x + w / 2
        x += w + 8
    text(x + 10, 227, '99% sure', 13, t['ok'], SANS, 600)

    # 3. back to text
    step(292, 3, 'The number becomes the exact text again', 'doc.pick(choice)')
    o.append(f'<rect x="48" y="310" width="{W-96}" height="46" rx="10" fill="{t["chip"]}" stroke="{t["line"]}"/>')
    text(66, 339, "{ value: 'recieved', start: 16, end: 24 }", 15, t['ink'], MONO, 500)
    text(W - 66, 339, 'text.slice(16, 24) === value, always', 13, t['muted'], SANS, 400, 'end')
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} 372" width="{W}" height="372" role="img" aria-label="How jeveryword works: number every word, let Jev pick a number, turn the number back into the exact text">' + ''.join(o) + '</svg>\n'

for name, theme in THEMES.items():
    open(f'docs/how-it-works-{name}.svg', 'w').write(build(theme))
print('ok')
