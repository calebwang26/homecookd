import sys
def lum(h):
    h=h.lstrip('#'); r,g,b=[int(h[i:i+2],16)/255 for i in (0,2,4)]
    f=lambda c: c/12.92 if c<=0.03928 else ((c+0.055)/1.055)**2.4
    return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b)
def cr(a,b):
    la,lb=lum(a),lum(b); hi,lo=max(la,lb),min(la,lb); return (hi+0.05)/(lo+0.05)
pairs=[l.split() for l in sys.stdin.read().strip().splitlines() if l.strip() and not l.startswith('//')]
for p in pairs:
    fg,bg,need=p[0],p[1],float(p[2]); label=' '.join(p[3:])
    c=cr(fg,bg); ok='PASS' if c>=need else 'FAIL'
    print(f"{ok:4} {c:5.2f} (need {need}) {fg} on {bg}  {label}")
