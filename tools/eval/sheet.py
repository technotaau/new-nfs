"""Step 3: comparison sheets (original | mask | lock only | renew+lock x2). Run inside $EVAL_OUT."""
import json, numpy as np
from PIL import Image, ImageDraw, ImageFont
meta=json.load(open("meta.json"))
T=380
def load(m, suf):
    return Image.fromarray(np.fromfile(f"{m['id']}{suf}.rgba",np.uint8).reshape(m['h'],m['w'],4)[...,:3])
def overlay(m):
    p=np.asarray(Image.open(f"{m['id']}_photo.png"),np.float32); k=np.asarray(Image.open(f"{m['id']}_mask.png"),np.float32)[...,None]/255*0.55
    return Image.fromarray((p*(1-k)+np.array([30,160,255])*k).astype(np.uint8))
def tile(img,label):
    s=T/img.width; img=img.resize((T,round(img.height*s)),Image.LANCZOS)
    d=ImageDraw.Draw(img); d.rectangle([0,0,T,18],fill=(0,0,0)); d.text((4,3),label,fill=(255,255,255)); return img
cols=[("original",lambda m:load(m,"")),("detected mask (old model)",overlay),("color lock only - Natural Cedar",lambda m:load(m,"_lock_cedar")),
      ("renew + lock - Natural Cedar",lambda m:load(m,"_renew_cedar")),("renew + lock - Redwood",lambda m:load(m,"_renew_redwood"))]
def build(ms,out):
    rows=[]
    for m in ms:
        ts=[tile(f(m),f"{m['id']} {lab}" if i==0 else lab) for i,(lab,f) in enumerate(cols)]
        hh=max(t.height for t in ts); row=Image.new("RGB",(T*len(ts)+4*(len(ts)-1),hh),(34,34,34))
        for i,t in enumerate(ts): row.paste(t,(i*(T+4),0))
        rows.append(row)
    H=sum(r.height for r in rows)+6*(len(rows)-1); sheet=Image.new("RGB",(rows[0].width,H),(34,34,34)); y=0
    for r in rows: sheet.paste(r,(0,y)); y+=r.height+6
    sheet.save(out,quality=88)
ok=[m for m in meta if m['coverage']>0.01]
build(ok[:6],"sheet_a.jpg"); build(ok[6:],"sheet_b.jpg")
print([m['id'] for m in ok])
