#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
灵屏 LumaSign · 跨平台图标生成器（纯标准库，无第三方依赖）

设计概念：智能发光屏（灵屏 = 灵 + 屏；Luma = 光）。
  - 圆角方形渐变底（#2563EB 蓝 -> #06B6D4 青，寓意“光/亮度”）
  - 白色“屏幕”面板（数字标牌的屏幕）
  - 屏幕内蓝色节目内容 + 一道发光白光带（Luma 之光）

输出：
  - desktop/build/icon.ico           Windows 多尺寸图标
  - desktop/build/icon.icns          macOS 多尺寸图标
  - desktop/tray.png                 系统托盘图标
  - android/.../mipmap-*/ic_launcher(_round).png   传统多密度图标
  - android/.../mipmap-anydpi-v26/ic_launcher*.xml 自适应图标
  - android/.../drawable/ic_launcher_{foreground,background}.png 自适应图层
  - android/playstore-icon.png       Play 商店 512 图标
  - admin/favicon.png                Web 管理端 favicon
"""
import math
import os
import struct
import zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# ---- 调色板 ----
G1 = (37, 99, 235)    # #2563EB 蓝
G2 = (6, 182, 212)    # #06B6D4 青
CB1 = (59, 130, 246)  # #3B82F6 内容蓝
CB2 = (29, 77, 216)   # #1D4ED8 内容深蓝
WHITE = (255, 255, 255)


def clamp(v, a, b):
    return a if v < a else (b if v > b else v)


def lerp(a, b, t):
    return a + (b - a) * t


def grad(c1, c2, t):
    return (lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t))


def grad_diag(c1, c2, x, y, x0, y0, x1, y1):
    t = clamp((x - x0) / (x1 - x0) * 0.5 + (y - y0) / (y1 - y0) * 0.5, 0, 1)
    return grad(c1, c2, t)


def set_px(px, w, h, x, y, r, g, b, a):
    """straight-alpha over 合成 (a: 0..1)"""
    if a <= 0:
        return
    i = (y * w + x) * 4
    dr, dg, db, da = px[i], px[i + 1], px[i + 2], px[i + 3] / 255.0
    oa = a + da * (1 - a)
    if oa <= 0:
        px[i] = px[i + 1] = px[i + 2] = px[i + 3] = 0
        return
    px[i] = int(round(clamp((r * a + dr * da * (1 - a)) / oa, 0, 255)))
    px[i + 1] = int(round(clamp((g * a + dg * da * (1 - a)) / oa, 0, 255)))
    px[i + 2] = int(round(clamp((b * a + db * da * (1 - a)) / oa, 0, 255)))
    px[i + 3] = int(round(clamp(oa * 255, 0, 255)))


def draw_rr(px, w, h, x0, y0, x1, y1, r, colorfn):
    """圆角矩形（带 1px 抗锯齿），仅遍历包围盒"""
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    hx, hy = (x1 - x0) / 2, (y1 - y0) / 2
    r = min(r, hx, hy)
    xs = max(0, int(math.floor(x0 - r)))
    xe = min(w, int(math.ceil(x1 + r)))
    ys = max(0, int(math.floor(y0 - r)))
    ye = min(h, int(math.ceil(y1 + r)))
    for y in range(ys, ye):
        for x in range(xs, xe):
            qx = abs(x + 0.5 - cx) - max(hx - r, 0)
            qy = abs(y + 0.5 - cy) - max(hy - r, 0)
            sd = math.hypot(max(qx, 0), max(qy, 0)) + min(max(qx, qy), 0) - r
            cov = clamp(0.5 - sd, 0, 1)
            if cov <= 0:
                continue
            col = colorfn(x + 0.5, y + 0.5)
            a = cov * (col[3] if len(col) > 3 else 1)
            if a <= 0:
                continue
            set_px(px, w, h, x, y, col[0], col[1], col[2], a)


def seg_dist(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    L2 = dx * dx + dy * dy
    if L2 == 0:
        return math.hypot(px - ax, py - ay)
    t = clamp(((px - ax) * dx + (py - ay) * dy) / L2, 0, 1)
    cx, cy = ax + dx * t, ay + dy * t
    return math.hypot(px - cx, py - cy)


def draw_capsule(px, w, h, ax, ay, bx, by, rh, sigma, color):
    """发光胶囊（白光带）：实心内核 + 高斯辉光"""
    xs = max(0, int(math.floor(min(ax, bx) - rh - 3 * sigma)))
    xe = min(w, int(math.ceil(max(ax, bx) + rh + 3 * sigma)))
    ys = max(0, int(math.floor(min(ay, by) - rh - 3 * sigma)))
    ye = min(h, int(math.ceil(max(ay, by) + rh + 3 * sigma)))
    for y in range(ys, ye):
        for x in range(xs, xe):
            d = seg_dist(x + 0.5, y + 0.5, ax, ay, bx, by)
            core = clamp((rh - d) + 0.5, 0, 1)
            glow = math.exp(-(d * d) / (sigma * sigma))
            a = max(core, glow * 0.85)
            if a <= 0:
                continue
            set_px(px, w, h, x, y, color[0], color[1], color[2], a)


def render(mode, N):
    px = bytearray(N * N * 4)
    if mode == 'bg':
        # 自适应背景：铺满整张 108 画布（系统遮罩负责圆角）
        for y in range(N):
            for x in range(N):
                c = grad_diag(G1, G2, x, y, 0, 0, N, N)
                set_px(px, N, N, x, y, c[0], c[1], c[2], 1)
        return px
    # 通用几何（按 N 的比例）
    tile_r = 0.22 * N
    if mode == 'full':
        s_in, c_in, l_ax, l_bx, l_rh, l_sigma = 0.16, 0.30, 0.38, 0.62, 0.030, 0.060
    elif mode == 'fg':
        s_in, c_in, l_ax, l_bx, l_rh, l_sigma = 0.18, 0.34, 0.40, 0.60, 0.025, 0.050
    else:
        raise ValueError(mode)
    # 1) 圆角渐变底
    draw_rr(px, N, N, 0, 0, N, N, tile_r,
            lambda x, y: grad_diag(G1, G2, x, y, 0, 0, N, N))
    # 2) 白色屏幕面板
    s0 = s_in * N
    draw_rr(px, N, N, s0, s0, N - s0, N - s0, 0.09 * N,
            lambda x, y: (WHITE[0], WHITE[1], WHITE[2], 1))
    # 3) 蓝色节目内容
    c0 = c_in * N
    draw_rr(px, N, N, c0, c0, N - c0, N - c0, 0.05 * N,
            lambda x, y: grad_diag(CB1, CB2, x, y, c0, c0, N - c0, N - c0))
    # 4) 发光白光带
    cy = 0.5 * N
    draw_capsule(px, N, N, l_ax * N, cy, l_bx * N, cy, l_rh * N, l_sigma * N, WHITE)
    return px


# ---------------- 编码 ----------------
def crc32(b):
    return zlib.crc32(b) & 0xFFFFFFFF


def png_chunk(typ, data):
    return struct.pack('>I', len(data)) + typ + data + struct.pack('>I', crc32(typ + data))


def write_png(path, px, w, h):
    raw = bytearray()
    for y in range(h):
        raw.append(0)  # filter type 0
        row = px[y * w * 4:(y + 1) * w * 4]
        raw.extend(row)
    comp = zlib.compress(bytes(raw), 9)
    with open(path, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n')
        f.write(png_chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)))
        f.write(png_chunk(b'IDAT', comp))
        f.write(png_chunk(b'IEND', b''))


def write_ico(path, sizes):
    items = []
    for N in sizes:
        buf = bytearray()
        write_png_to(buf, render('full', N), N, N)
        items.append((N, bytes(buf)))
    out = bytearray()
    out += struct.pack('<HHH', 0, 1, len(items))
    offset = 6 + len(items) * 16
    for N, img in items:
        wb = 0 if N >= 256 else N   # ICO 规范：256 用 0 表示
        out += struct.pack('<BBBBHHII', wb, wb, 0, 0, 1, 32, len(img), offset)
        offset += len(img)
    for _, img in items:
        out += img
    with open(path, 'wb') as f:
        f.write(out)


def write_png_to(buf, px, w, h):
    raw = bytearray()
    for y in range(h):
        raw.append(0)
        raw.extend(px[y * w * 4:(y + 1) * w * 4])
    comp = zlib.compress(bytes(raw), 9)
    buf += b'\x89PNG\r\n\x1a\n'
    buf += png_chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
    buf += png_chunk(b'IDAT', comp)
    buf += png_chunk(b'IEND', b'')


def write_icns(path, sizes):
    # OSType -> 尺寸
    type_for = {
        16: 'ic04', 32: 'ic05', 64: 'ic11', 128: 'ic07',
        256: 'ic08', 512: 'ic09', 1024: 'ic10',
    }
    # 额外补充 @2x
    extra = {128: 'ic12', 512: 'ic13', 1024: 'ic14'}
    entries = []
    seen = {}
    for N in sizes:
        png = bytearray()
        write_png_to(png, render('full', N), N, N)
        t = type_for[N]
        if t not in seen:
            entries.append((t, bytes(png)))
            seen[t] = 1
    for N, t in extra.items():
        if N in sizes and t not in seen:
            png = bytearray()
            write_png_to(png, render('full', N), N, N)
            entries.append((t, bytes(png)))
            seen[t] = 1
    body = bytearray()
    for t, data in entries:
        body += t.encode('ascii') + struct.pack('>I', len(data)) + data
    out = b'icns' + struct.pack('>I', 8 + len(body)) + body
    with open(path, 'wb') as f:
        f.write(out)


def makedirs(p):
    os.makedirs(p, exist_ok=True)


def main():
    # ---- Windows / macOS ----
    bdir = os.path.join(ROOT, 'desktop', 'build')
    makedirs(bdir)
    write_ico(os.path.join(bdir, 'icon.ico'), [16, 32, 48, 64, 128, 256])
    write_icns(os.path.join(bdir, 'icon.icns'), [16, 32, 64, 128, 256, 512, 1024])
    write_png(os.path.join(ROOT, 'desktop', 'tray.png'), render('full', 32), 32, 32)

    # ---- Android 传统多密度 ----
    dens = {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}
    for d, N in dens.items():
        ddir = os.path.join(ROOT, 'android', 'app', 'src', 'main', 'res', 'mipmap-' + d)
        makedirs(ddir)
        p = render('full', N)
        write_png(os.path.join(ddir, 'ic_launcher.png'), p, N, N)
        write_png(os.path.join(ddir, 'ic_launcher_round.png'), p, N, N)

    # ---- Android 自适应图标 ----
    adir = os.path.join(ROOT, 'android', 'app', 'src', 'main', 'res', 'mipmap-anydpi-v26')
    makedirs(adir)
    write_adaptive_xml(os.path.join(adir, 'ic_launcher.xml'), 'ic_launcher')
    write_adaptive_xml(os.path.join(adir, 'ic_launcher_round.xml'), 'ic_launcher_round')
    ddir = os.path.join(ROOT, 'android', 'app', 'src', 'main', 'res', 'drawable')
    makedirs(ddir)
    write_png(os.path.join(ddir, 'ic_launcher_background.png'), render('bg', 108), 108, 108)
    write_png(os.path.join(ddir, 'ic_launcher_foreground.png'), render('fg', 108), 108, 108)

    # ---- Play 商店 512 ----
    write_png(os.path.join(ROOT, 'android', 'playstore-icon.png'), render('full', 512), 512, 512)

    # ---- Web 管理端 favicon ----
    adir2 = os.path.join(ROOT, 'admin')
    makedirs(adir2)
    write_png(os.path.join(adir2, 'favicon.png'), render('full', 64), 64, 64)
    print('OK icons generated')


def write_adaptive_xml(path, name):
    xml = (
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
        '    <background android:drawable="@drawable/ic_launcher_background" />\n'
        '    <foreground android:drawable="@drawable/ic_launcher_foreground" />\n'
        '</adaptive-icon>\n'
    )
    with open(path, 'w', encoding='utf-8') as f:
        f.write(xml)


if __name__ == '__main__':
    main()
