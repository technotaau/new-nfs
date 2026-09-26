"""Step 1 of the real-photo eval: resize photos, get masks from a /detect endpoint.
Usage: EVAL_PHOTOS=/path/to/photos EVAL_OUT=/path/to/workdir python3 prep.py
Photos are NOT stored in git (they may be homeowners' photos). Requires: pillow, numpy."""
import io, os, sys, json, time, urllib.request, uuid
from PIL import Image, ImageOps
import numpy as np
SEL = [("hires","1000004327.jpg","weathered grey, AC units"),("hires","1000004330.jpg","half grey / half fresh"),
       ("hires","1000004331.jpg","weathered grey, wide yard"),("hires","1000004332.jpg","weathered grey, far"),
       ("hires","PXL_20240719_RESTORED.webp","dark mildew close-up"),("hires","br-indy-fence-staining-3.webp","before, pale grey"),
       ("hires","20260504_102140.jpg","pale wood, tarps"),("hires","20260505_124633.jpg","already stained brown, close"),
       ("web","Shadowbox-Indianapolis.webp","before, grey shadowbox"),("web","gray-weathered-before-after-houston.webp","before/after split"),
       ("web","old-worn-fence-before.jpg","old worn, distant"),("web","proluxe-chestnut-solid-stain.webp","before, grey"),
       ("web","three-year-old-fence-backyard.jpg","3-year-old grey")]
URL=os.environ.get("EVAL_DETECT_URL","https://dev-45325--f-stain-dinov3-inference-web.modal.run/detect")
PHOTOS=os.environ.get("EVAL_PHOTOS","/home/user/eval-photos")
os.makedirs(os.environ.get("EVAL_OUT","eval-out"),exist_ok=True); os.chdir(os.environ.get("EVAL_OUT","eval-out"))
def post(jpeg):
    b = uuid.uuid4().hex
    body = (f"--{b}\r\nContent-Disposition: form-data; name=\"image\"; filename=\"f.jpg\"\r\nContent-Type: image/jpeg\r\n\r\n").encode()+jpeg+f"\r\n--{b}--\r\n".encode()
    r = urllib.request.Request(URL, data=body, headers={"Content-Type": f"multipart/form-data; boundary={b}"})
    t=time.time(); resp = urllib.request.urlopen(r, timeout=300); data=resp.read()
    return data, time.time()-t, resp.status
meta=[]
for i,(d,f,desc) in enumerate(SEL):
    im = ImageOps.exif_transpose(Image.open(f"{PHOTOS}/{d}/{f}")).convert("RGB")
    s = min(1, 1536/max(im.size)); W,H = round(im.width*s), round(im.height*s)
    work = im.resize((W,H), Image.LANCZOS)
    s2 = min(1, 1024/max(im.size)); up = im.resize((round(im.width*s2), round(im.height*s2)), Image.LANCZOS)
    buf=io.BytesIO(); up.save(buf,"JPEG",quality=85)
    try:
        png, dt, st = post(buf.getvalue())
        m = Image.open(io.BytesIO(png)).convert("L").resize((W,H), Image.BILINEAR)
    except Exception as e:
        print(i, f, "detect failed", e); continue
    name=f"{i:02d}"
    work.save(f"{name}_photo.png"); m.save(f"{name}_mask.png")
    np.asarray(work.convert("RGBA"),np.uint8).tofile(f"{name}.rgba")
    (np.asarray(m,np.float32)/255).tofile(f"{name}.mask")
    cov=float((np.asarray(m)>127).mean())
    meta.append(dict(id=name,file=f,desc=desc,w=W,h=H,detect_s=round(dt,2),coverage=round(cov,3)))
    print(name, f, f"{W}x{H}", f"detect {dt:.1f}s", f"coverage {cov:.0%}", flush=True)
json.dump(meta, open("meta.json","w"), indent=1)
