# -*- coding: utf-8 -*-
"""从原始 logo 图生成应用标识资源：
1) 去掉浅灰底（外部泛洪填充 + 预乘 alpha 缩放，边缘不发黑）
2) 输出 assets/logo-light.png（原色）与 assets/logo-dark.png（深色主题提亮版）
3) 生成 build/icon.png、build/icon.ico、src-tauri/icons/icon.ico（白色圆角瓷砖 + 标识）

用法：python tools/make_logo.py <源图.jpg>
"""
import sys, os
from collections import deque
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = sys.argv[1] if len(sys.argv) > 1 else r'C:\Users\Administrator\.workbuddy\clipboard-images\clipboard-2026-11-01T17-28-14-404Z-76a50f2e.jpg'


def near_bg(c, bg, tol):
    return abs(c[0] - bg[0]) <= tol and abs(c[1] - bg[1]) <= tol and abs(c[2] - bg[2]) <= tol


def cut_background(im):
    """返回 (RGBA 图, 内容包围盒)。外部背景全透明，内部像素保持不透明。"""
    im = im.convert('RGB')
    W, H = im.size
    px = im.load()
    # 背景色取四边中点中位数
    edge = [px[0, 0], px[W - 1, 0], px[0, H - 1], px[W - 1, H - 1], px[W // 2, 2], px[2, H // 2]]
    bg = tuple(sorted(edge)[len(edge) // 2])
    tol = 26

    out = bytearray(W * H)          # 1 = 外部背景
    q = deque()
    for x in range(W):
        for y in (0, H - 1):
            if not out[y * W + x] and near_bg(px[x, y], bg, tol):
                out[y * W + x] = 1; q.append((x, y))
    for y in range(H):
        for x in (0, W - 1):
            if not out[y * W + x] and near_bg(px[x, y], bg, tol):
                out[y * W + x] = 1; q.append((x, y))
    while q:
        x, y = q.popleft()
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < W and 0 <= ny < H and not out[ny * W + nx] and near_bg(px[nx, ny], bg, tol):
                out[ny * W + nx] = 1; q.append((nx, ny))

    rgba = Image.new('RGBA', (W, H))
    dst = rgba.load()
    minx, miny, maxx, maxy = W, H, -1, -1
    for y in range(H):
        row = y * W
        for x in range(W):
            if out[row + x]:
                dst[x, y] = (255, 255, 255, 0)      # 透明处填白，避免缩小时边缘发黑
            else:
                dst[x, y] = px[x, y] + (255,)
                if x < minx: minx = x
                if y < miny: miny = y
                if x > maxx: maxx = x
                if y > maxy: maxy = y
    return rgba, (minx, miny, maxx, maxy)


def resize_rgba(im, size):
    """预乘 alpha 缩放，避免半透明边缘混入白色/黑色描边。"""
    r, g, b, a = im.split()
    prem = Image.merge('RGBA', (r, g, b, a))
    px = prem.load()
    W, H = prem.size
    for y in range(H):
        for x in range(W):
            p = px[x, y]
            al = p[3] / 255.0
            px[x, y] = (int(p[0] * al), int(p[1] * al), int(p[2] * al), p[3])
    small = prem.resize(size, Image.LANCZOS)
    sp = small.load()
    w, h = small.size
    for y in range(h):
        for x in range(w):
            p = sp[x, y]
            al = p[3] / 255.0
            if al <= 0.001:
                sp[x, y] = (255, 255, 255, 0)
            else:
                sp[x, y] = (min(255, int(p[0] / al)), min(255, int(p[1] / al)), min(255, int(p[2] / al)), p[3])
    return small


def lighten_for_dark(im, gamma=0.48, white=0.12):
    """深色主题版：逐通道 gamma 提亮 + 少量白混合。
    深海军蓝的 HSV 明度只有 0.28，按 V 提升仍偏暗（对比度不到 2:1）；
    逐通道 gamma 对低通道增益最大，色相基本不变，深底上对比度可到 ~3:1。"""
    im = im.convert('RGBA')
    px = im.load()
    W, H = im.size
    for y in range(H):
        for x in range(W):
            r, g, b, a = px[x, y]
            if a < 8:
                continue
            nr = (r / 255) ** gamma * (1 - white) + white
            ng = (g / 255) ** gamma * (1 - white) + white
            nb = (b / 255) ** gamma * (1 - white) + white
            px[x, y] = (int(nr * 255), int(ng * 255), int(nb * 255), a)
    return im


def make_icon(logo, size=512, tile='light'):
    """白色（或深色）圆角瓷砖 + 居中标识，Windows 任务栏/资源管理器用。"""
    S = size * 4
    canvas = Image.new('RGBA', (S, S), (255, 255, 255, 0))
    d = ImageDraw.Draw(canvas)
    radius = int(S * 0.22)
    if tile == 'light':
        d.rounded_rectangle([0, 0, S - 1, S - 1], radius=radius, fill=(255, 255, 255, 255))
        d.rounded_rectangle([0, 0, S - 1, S - 1], radius=radius, outline=(226, 230, 236, 255), width=max(2, S // 220))
    else:
        d.rounded_rectangle([0, 0, S - 1, S - 1], radius=radius, fill=(18, 21, 27, 255))
    inner = int(S * 0.76)
    lg = logo.resize((inner, inner), Image.LANCZOS)
    canvas.alpha_composite(lg, ((S - inner) // 2, (S - inner) // 2))
    return canvas.resize((size, size), Image.LANCZOS)


def main():
    src = Image.open(SRC)
    cut, box = cut_background(src)
    print('内容包围盒', box)
    pad = 8
    x0, y0, x1, y1 = box
    x0, y0 = max(0, x0 - pad), max(0, y0 - pad)
    x1, y1 = min(cut.width - 1, x1 + pad), min(cut.height - 1, y1 + pad)
    cut = cut.crop((x0, y0, x1 + 1, y1 + 1))
    # 补成正方形（居中），保证浏览器里按高度缩放时四边等宽
    w, h = cut.size
    side = max(w, h)
    sq = Image.new('RGBA', (side, side), (255, 255, 255, 0))
    sq.alpha_composite(cut, ((side - w) // 2, (side - h) // 2))
    print('正方形内容', sq.size)

    os.makedirs(os.path.join(ROOT, 'assets'), exist_ok=True)
    light = resize_rgba(sq, (512, 512))
    light.save(os.path.join(ROOT, 'assets', 'logo-light.png'))
    dark = lighten_for_dark(light.copy())
    dark.save(os.path.join(ROOT, 'assets', 'logo-dark.png'))
    print('已写 assets/logo-light.png / logo-dark.png')

    icon = make_icon(light, 512, 'light')
    icon.save(os.path.join(ROOT, 'build', 'icon.png'))
    os.makedirs(os.path.join(ROOT, 'src-tauri', 'icons'), exist_ok=True)
    sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    icon.save(os.path.join(ROOT, 'build', 'icon.ico'), sizes=sizes)
    icon.save(os.path.join(ROOT, 'src-tauri', 'icons', 'icon.ico'), sizes=sizes)
    print('已写 build/icon.png / build/icon.ico / src-tauri/icons/icon.ico')

    # 自检图：浅底 + 深底各一行，看清边缘与可读性
    prev = Image.new('RGB', (560, 300), (255, 255, 255))
    prev.paste(Image.new('RGB', (560, 150), (23, 24, 28)), (0, 150))
    prev.paste(light.resize((96, 96), Image.LANCZOS), (16, 27), light.resize((96, 96), Image.LANCZOS))
    prev.paste(dark.resize((96, 96), Image.LANCZOS), (16, 177), dark.resize((96, 96), Image.LANCZOS))
    prev.paste(icon.resize((96, 96), Image.LANCZOS), (130, 27), icon.resize((96, 96), Image.LANCZOS))
    prev.paste(light.resize((26, 26), Image.LANCZOS), (250, 62), light.resize((26, 26), Image.LANCZOS))
    prev.paste(dark.resize((26, 26), Image.LANCZOS), (250, 212), dark.resize((26, 26), Image.LANCZOS))
    prev.save(os.path.join(ROOT, 'tools', 'ui-shots', 'v8-logo-assets.png'))
    print('自检图 tools/ui-shots/v8-logo-assets.png')


if __name__ == '__main__':
    main()
