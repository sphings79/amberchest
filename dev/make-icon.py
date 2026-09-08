#!/usr/bin/env python3
"""Generates the application icon without any image library.

Draws a rounded square with a vertical gradient and a white envelope on top,
supersampled 4x for smooth edges, and writes a PNG. Run from the repo root:

    python3 dev/make-icon.py packages/desktop/build/icon.png
"""
import struct
import sys
import zlib
from pathlib import Path

SIZE = 1024
SS = 4  # supersampling factor
W = SIZE * SS

TOP = (150, 116, 255)
BOTTOM = (98, 68, 226)
WHITE = (255, 255, 255)


def rounded_rect_coverage(x, y, size, radius):
    """1 inside the rounded square, 0 outside."""
    inset = size * 0.085
    left, top = inset, inset
    right, bottom = size - inset, size - inset
    if x < left or x > right or y < top or y > bottom:
        return 0.0
    cx = min(max(x, left + radius), right - radius)
    cy = min(max(y, top + radius), bottom - radius)
    dx, dy = x - cx, y - cy
    return 1.0 if dx * dx + dy * dy <= radius * radius else 0.0


def envelope_coverage(x, y, size):
    """The white envelope: body outline plus the flap lines."""
    w = size * 0.52
    h = w * 0.72
    left = (size - w) / 2
    top = (size - h) / 2 + size * 0.01
    right, bottom = left + w, top + h
    stroke = size * 0.032
    radius = size * 0.045

    inside_outer = rounded_rect_coverage(
        x - left + size * 0.085, y - top + size * 0.085, w + 2 * size * 0.085, radius
    )
    inside_inner = rounded_rect_coverage(
        x - left - stroke + size * 0.085,
        y - top - stroke + size * 0.085,
        w - 2 * stroke + 2 * size * 0.085,
        max(radius - stroke, 1),
    )
    if inside_outer and not inside_inner:
        return 1.0

    # Flap: two straight lines from the upper corners to the centre.
    if left <= x <= right and top <= y <= bottom:
        mid_x = (left + right) / 2
        target_y = top + h * 0.46
        if x <= mid_x:
            t = (x - left) / (mid_x - left)
        else:
            t = (right - x) / (right - mid_x)
        line_y = top + stroke * 0.5 + t * (target_y - top)
        if abs(y - line_y) <= stroke * 0.62:
            return 1.0
    return 0.0


def main():
    out = Path(sys.argv[1] if len(sys.argv) > 1 else 'icon.png')
    out.parent.mkdir(parents=True, exist_ok=True)

    radius = SIZE * 0.225
    rows = []
    for py in range(SIZE):
        row = bytearray()
        for px in range(SIZE):
            r = g = b = a = 0.0
            for sy in range(SS):
                for sx in range(SS):
                    x = px + (sx + 0.5) / SS
                    y = py + (sy + 0.5) / SS
                    cover = rounded_rect_coverage(x, y, SIZE, radius)
                    if cover == 0.0:
                        continue
                    t = y / SIZE
                    base = tuple(TOP[i] + (BOTTOM[i] - TOP[i]) * t for i in range(3))
                    if envelope_coverage(x, y, SIZE):
                        base = WHITE
                    r += base[0]
                    g += base[1]
                    b += base[2]
                    a += 255
            n = SS * SS
            row += bytes((int(r / n), int(g / n), int(b / n), int(a / n)))
        rows.append(bytes(row))

    raw = b''.join(b'\x00' + row for row in rows)

    def chunk(tag, data):
        return (
            struct.pack('>I', len(data))
            + tag
            + data
            + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('>IIBBBBB', SIZE, SIZE, 8, 6, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(raw, 9))
    png += chunk(b'IEND', b'')
    out.write_bytes(png)
    print(f'wrote {out} ({len(png)} bytes)')


if __name__ == '__main__':
    main()
