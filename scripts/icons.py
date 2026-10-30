"""Render the small geometric PageLingo mark, with no third-party dependency."""
from pathlib import Path
import math
import struct
import zlib

ROOT = Path(__file__).resolve().parent.parent
GRAPHITE = (48, 54, 64)
WARM_WHITE = (247, 247, 242)
BORDER = tuple(round(edge * .55 + base * .45) for edge, base in zip((139, 146, 156), GRAPHITE))


def cubic(start, first, second, end):
    # Trace the same cubic curves used by assets/logo.svg.
    return [tuple((1-t)**3 * start[i] + 3*(1-t)**2*t * first[i]
                  + 3*(1-t)*t*t * second[i] + t**3 * end[i]
                  for i in range(2)) for t in (step / 32 for step in range(1, 33))]


P_SHAPE = [(19, 15), (33, 15)] + cubic((33, 15), (42, 15), (48, 20), (48, 28)) \
    + cubic((48, 28), (48, 36), (42, 42), (33, 42)) + [(27, 42), (27, 51), (19, 51)]
P_HOLE = [(27, 23), (27, 34), (33, 34)] + cubic((33, 34), (37, 34), (40, 32), (40, 28)) \
    + cubic((40, 28), (40, 24), (37, 23), (33, 23))


def in_polygon(x, y, points):
    inside = False
    previous = points[-1]
    for current in points:
        if (current[1] > y) != (previous[1] > y):
            crossing = (previous[0] - current[0]) * (y - current[1]) / (previous[1] - current[1]) + current[0]
            if x < crossing:
                inside = not inside
        previous = current
    return inside


def in_round_rect(x, y, inset, radius):
    if not inset <= x <= 64-inset or not inset <= y <= 64-inset:
        return False
    dx, dy = max(18-x, 0, x-46), max(18-y, 0, y-46)
    return dx*dx + dy*dy <= radius*radius


def in_round_line(x, y, start, end):
    dx, dy = end[0]-start[0], end[1]-start[1]
    position = max(0, min(1, ((x-start[0])*dx + (y-start[1])*dy)/(dx*dx+dy*dy)))
    return (x-start[0]-position*dx)**2 + (y-start[1]-position*dy)**2 <= 1.5**2

def color(x, y):
    # All geometry is in the 64-unit source logo coordinate system.
    if not in_round_rect(x, y, 0, 18):
        return (0, 0, 0, 0)
    if not in_round_rect(x, y, 1, 17):
        return (*BORDER, 255)
    p = in_polygon(x, y, P_SHAPE) and not in_polygon(x, y, P_HOLE)
    cross = in_round_line(x, y, (44, 44), (51, 51)) or in_round_line(x, y, (44, 51), (51, 44))
    return (*(WARM_WHITE if p or cross else GRAPHITE), 255)

def render(size):
    pixels = bytearray()
    for y in range(size):
        pixels.append(0)
        for x in range(size):
            samples = [color((x+(sx+.5)/4)*64/size, (y+(sy+.5)/4)*64/size) for sy in range(4) for sx in range(4)]
            alpha = sum(c[3] for c in samples)
            # PNG stores straight alpha: average covered colors separately so
            # partially transparent rounded edges do not gain a dark fringe.
            rgb = [round(sum(c[i]*c[3] for c in samples)/alpha) if alpha else 0 for i in range(3)]
            pixels.extend((*rgb, round(alpha/16)))
    def chunk(kind, data):
        return struct.pack('!I', len(data)) + kind + data + struct.pack('!I', zlib.crc32(kind+data)&0xffffffff)
    data = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('!2I5B', size, size, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(pixels, 9)) + chunk(b'IEND', b'')
    (ROOT/'assets'/f'icon{size}.png').write_bytes(data)

for dimension in (16, 32, 48, 128):
    render(dimension)
print('Generated 16, 32, 48 and 128 px icons')
