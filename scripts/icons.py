"""Render the small geometric PageLingo mark, with no third-party dependency."""
from pathlib import Path
import math
import struct
import zlib

ROOT = Path(__file__).resolve().parent.parent
LIME = (199, 239, 101)
INK = (38, 52, 26)

def color(x, y):
    # All geometry is in the 64-unit source logo coordinate system.
    dx, dy = max(18-x, 0, x-46), max(18-y, 0, y-46)
    if dx*dx + dy*dy > 18*18:
        return (0, 0, 0, 0)
    p = 19 <= x <= 27 and 15 <= y <= 51
    bowl = 27 <= x <= 33 and 15 <= y <= 42 or (x >= 33 and ((x-33)/15)**2 + ((y-28.5)/13.5)**2 <= 1)
    hole = 27 <= x <= 33 and 23 <= y <= 34 or (x >= 33 and ((x-33)/7)**2 + ((y-28.5)/5.5)**2 <= 1)
    cross = 43 <= x <= 52 and 43 <= y <= 52 and (abs(x-y) <= 1.7 or abs(x+y-95) <= 1.7)
    return (*(INK if (p or bowl) and not hole or cross else LIME), 255)

def render(size):
    pixels = bytearray()
    for y in range(size):
        pixels.append(0)
        for x in range(size):
            samples = [color((x+(sx+.5)/4)*64/size, (y+(sy+.5)/4)*64/size) for sy in range(4) for sx in range(4)]
            pixels.extend(round(sum(c[i] for c in samples)/16) for i in range(4))
    def chunk(kind, data):
        return struct.pack('!I', len(data)) + kind + data + struct.pack('!I', zlib.crc32(kind+data)&0xffffffff)
    data = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('!2I5B', size, size, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(pixels, 9)) + chunk(b'IEND', b'')
    (ROOT/'assets'/f'icon{size}.png').write_bytes(data)

for dimension in (16, 32, 48, 128):
    render(dimension)
print('Generated 16, 32, 48 and 128 px icons')
