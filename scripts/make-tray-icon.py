# Generates the menu bar template icon (five rounded waveform bars).
import struct, sys, zlib

def png(size, path):
    heights = [0.35, 0.7, 1.0, 0.6, 0.3]
    bar_w, gap = size * 0.12, size * 0.075
    total = len(heights) * bar_w + (len(heights) - 1) * gap
    x0 = (size - total) / 2
    rows = []
    for y in range(size):
        row = bytearray([0])
        for x in range(size):
            alpha = 0
            for i, h in enumerate(heights):
                left = x0 + i * (bar_w + gap)
                half = h * size * 0.42
                cy, r = size / 2, bar_w / 2
                cx = left + r
                px, py = x + 0.5, y + 0.5
                dy = max(abs(py - cy) - (half - r), 0)
                if (px - cx) ** 2 + dy ** 2 <= r * r:
                    alpha = 255
            row += bytes([0, 0, 0, alpha])
        rows.append(bytes(row))
    raw = zlib.compress(b''.join(rows), 9)
    def chunk(t, d):
        return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    data = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)) + chunk(b'IDAT', raw) + chunk(b'IEND', b'')
    open(path, 'wb').write(data)

out = sys.argv[1]
png(18, f'{out}/trayTemplate.png')
png(36, f'{out}/trayTemplate@2x.png')
