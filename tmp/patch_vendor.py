import io

def load(p):
    with io.open(p, encoding='utf-8') as f:
        return f.read()

def save(p, s):
    with io.open(p, 'w', encoding='utf-8', newline='') as f:
        f.write(s)

# ---------- 1) se3 bundle (React __FRAMER__ props): add hrefs + force new tab ----------
P = 'public/scripts/vendor/se3-2SIJUYB3043PhVxlwdaupu3LzIg4uS4CNC9Zlcs.DELc0mh1.mjs'
s = load(P)
before_len = len(s)

IG = '`https://www.instagram.com/bodamariysimon/`,'

pairs = [
    # IG buttons (desktop + mobile): were missing the link prop -> anchor rendered without href
    ("openInNewTab: !0,\n                                              azjbYCood: `999px`,\n                                              height: `100%`,\n                                              hyoIEBZCr: `Seguinos en IG`,",
     "openInNewTab: !0,\n                                              gHeOvXgAq: " + IG + "\n                                              azjbYCood: `999px`,\n                                              height: `100%`,\n                                              hyoIEBZCr: `Seguinos en IG`,"),
    # Confirma tu asistencia -> SPA internal route in same tab (was openInNewTab true, no href)
    ("openInNewTab: !0,\n                                        azjbYCood: `999px`,\n                                        height: `100%`,\n                                        hyoIEBZCr: `Confirma tu asistencia`,",
     "openInNewTab: !1,\n                                        gHeOvXgAq: `/rsvp/MARISIMON`,\n                                        azjbYCood: `999px`,\n                                        height: `100%`,\n                                        hyoIEBZCr: `Confirma tu asistencia`,"),
]
for old, new in pairs:
    n = s.count(old)
    assert n >= 1, ('pattern not found', old[:60])
    s = s.replace(old, new)
    print('replaced x%d:' % n, old.splitlines()[-1].strip()[:70])

# Guard inside the shared Button component (props destructured above this return):
# - if the button's `link` prop is an external http(s) URL, use it as href and drop the
#   onTap gesture (Framer's synthetic tap navigated through the site router -> local 500)
# - if the __FRAMER__ variant link prop (gHeOvXgAq) is external, force openInNewTab
old = "return p(T, {\n            id: m ?? a,"
assert s.count(old) == 1, 'button wrapper anchor not unique'
new = ("if (typeof dCFnvjj9x === `string` && /^https?:/i.test(dCFnvjj9x)) _ = dCFnvjj9x, jQvJLxAsd = void 0;\n"
       "          if (typeof gHeOvXgAq === `string` && /^https?:/i.test(gHeOvXgAq)) openInNewTab = !0;\n"
       + old)
s = s.replace(old, new)
print('injected guard in button component')
save(P, s)
print('OK', P, before_len, '->', len(s))

# ---------- 2) framer runtime: never do server-side navigation for external URLs ----------
# Zu(e) short-circuits the "server router" decision for absolute http(s) links, so a click
# on Ver inspiracion / Ver ubicacion can never trigger location.assign() through the local
# dev/cPanel router (that was the "internal error"). Client routing is untouched.
F = 'public/scripts/vendor/framer.DPCdg9NM.mjs'
t = load(F)
before_len = len(t)
old = "function Zu(e) {\n  let t = Hu(e);"
assert t.count(old) == 1, 'Zu() anchor not found'
new = "function Zu(e) {\n  if (/^https?:\\/\\//i.test(String(e))) return { decision: `client` };\n  let t = Hu(e);"
t = t.replace(old, new)
save(F, t)
print('OK', F, before_len, '->', len(t))
