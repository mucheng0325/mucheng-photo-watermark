# -*- coding: utf-8 -*-
"""生成演示用样例照片（带真实 EXIF），用于功能自检与界面预览。"""
import math, random, os
from PIL import Image, ImageDraw, ImageFilter, ImageChops

random.seed(20261101)
W, H = 3000, 2000

# 背景：暮色天空渐变
base = Image.new("RGB", (W, H), (12, 16, 26))
dr = ImageDraw.Draw(base)
for y in range(H):
    t = y / H
    r = int(18 + 120 * (t ** 1.7))
    g = int(22 + 70 * (t ** 1.9))
    b = int(34 + 96 * (t ** 1.6))
    dr.line([(0, y), (W, y)], fill=(r, g, b))

# 远景地平线霓虹光晕
glow = Image.new("RGB", (W, H), (0, 0, 0))
gd = ImageDraw.Draw(glow)
gd.ellipse([W * 0.35, H * 0.52, W * 0.95, H * 0.95], fill=(90, 40, 26))
gd.ellipse([W * 0.05, H * 0.60, W * 0.5, H * 0.98], fill=(16, 40, 62))
glow = glow.filter(ImageFilter.GaussianBlur(220))
base = ImageChops.add(base, glow, scale=1.25, offset=-20)

# 建筑剪影
sil = Image.new("RGBA", (W, H), (0, 0, 0, 0))
sd = ImageDraw.Draw(sil)
x = -80
while x < W + 100:
    bw = random.randint(90, 240)
    bh = random.randint(int(H * 0.10), int(H * 0.34))
    top = H - bh - int(H * 0.12)
    sd.rectangle([x, top, x + bw, H], fill=(8, 10, 16, 255))
    # 窗格灯
    for wy in range(top + 26, H - 40, 46):
        for wx in range(x + 18, x + bw - 18, 40):
            if random.random() < 0.42:
                c = random.choice([(255, 205, 130, 220), (255, 235, 190, 180), (140, 210, 255, 170)])
                sd.rectangle([wx, wy, wx + 12, wy + 16], fill=c)
    x += bw + random.randint(14, 46)
base = Image.alpha_composite(base.convert("RGBA"), sil).convert("RGB")

# 前景虚化光斑（景深）
bokeh = Image.new("RGB", (W, H), (0, 0, 0))
bd = ImageDraw.Draw(bokeh)
for _ in range(26):
    cx, cy = random.randint(0, W), random.randint(int(H * 0.45), H)
    r = random.randint(40, 150)
    col = random.choice([(255, 190, 120), (120, 220, 255), (255, 120, 170), (255, 240, 200)])
    bd.ellipse([cx - r, cy - r, cx + r, cy + r], fill=col)
bokeh = bokeh.filter(ImageFilter.GaussianBlur(46))
base = ImageChops.add(base, bokeh, scale=1.0, offset=-8)

# 暗角
vig = Image.new("L", (W, H), 0)
vd = ImageDraw.Draw(vig)
vd.ellipse([-W * 0.25, -H * 0.3, W * 1.25, H * 1.3], fill=255)
vig = vig.filter(ImageFilter.GaussianBlur(260))
black = Image.new("RGB", (W, H), (0, 0, 0))
base = Image.composite(base, black, vig)

# 轻微噪点，贴近实拍
noise = Image.effect_noise((W, H), 8).convert("L")
base = ImageChops.add(base, Image.merge("RGB", (noise, noise, noise)), scale=1.0, offset=-6)

# EXIF
exif = Image.Exif()
exif[0x010F] = "Canon"                       # Make
exif[0x0110] = "Canon EOS R6 Mark II"         # Model
exif[0x0131] = "EXIF CAM Demo"
exif[0x0132] = "2026:11:01 16:30:12"
exif[0x0112] = 1
exif[0x9003] = "2026:11:01 16:30:12"
exif[0x829D] = 1.8                            # FNumber
exif[0x829A] = (1, 200)                       # ExposureTime
exif[0x8827] = 400                            # ISO
exif[0x920A] = 50.0                           # FocalLength
exif[0xA405] = 50                             # FocalLength35
exif[0xA434] = "RF50mm F1.8 STM"
exif[0xA002] = W
exif[0xA003] = H

here = os.path.dirname(os.path.abspath(__file__))
out = os.path.join(here, "demo.jpg")
base.save(out, "JPEG", quality=92, exif=exif.tobytes())
print("saved:", out, base.size)
