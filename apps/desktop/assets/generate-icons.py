import ctypes as c
import struct
from pathlib import Path

root = Path(__file__).resolve().parent
rsvg = c.CDLL("librsvg-2.so.2")
cairo = c.CDLL("libcairo.so.2")
gobject = c.CDLL("libgobject-2.0.so.0")


def signature(library, name, result, *arguments):
    function = getattr(library, name)
    function.restype = result
    function.argtypes = arguments
    return function


class Rectangle(c.Structure):
    _fields_ = [(name, c.c_double) for name in ("x", "y", "width", "height")]


create_svg = signature(rsvg, "rsvg_handle_new_from_data", c.c_void_p, c.c_char_p, c.c_size_t, c.c_void_p)
render = signature(rsvg, "rsvg_handle_render_document", c.c_int, c.c_void_p, c.c_void_p, c.POINTER(Rectangle), c.c_void_p)
create_surface = signature(cairo, "cairo_image_surface_create", c.c_void_p, c.c_int, c.c_int, c.c_int)
create_context = signature(cairo, "cairo_create", c.c_void_p, c.c_void_p)
destroy_context = signature(cairo, "cairo_destroy", None, c.c_void_p)
destroy_surface = signature(cairo, "cairo_surface_destroy", None, c.c_void_p)
release_svg = signature(gobject, "g_object_unref", None, c.c_void_p)
write_callback = c.CFUNCTYPE(c.c_int, c.c_void_p, c.c_void_p, c.c_uint)
write_png = signature(cairo, "cairo_surface_write_to_png_stream", c.c_int, c.c_void_p, write_callback, c.c_void_p)

source = (root / "vrata.svg").read_bytes()
svg = create_svg(source, len(source), None)
if not svg:
    raise RuntimeError("Cannot read vrata.svg")


def png(size):
    surface = create_surface(0, size, size)
    context = create_context(surface)
    chunks = []

    @write_callback
    def collect(_closure, data, length):
        chunks.append(c.string_at(data, length))
        return 0

    try:
        if not render(svg, context, c.byref(Rectangle(0, 0, size, size)), None):
            raise RuntimeError("Cannot render vrata.svg")
        if write_png(surface, collect, None) != 0:
            raise RuntimeError("Cannot encode PNG")
        return b"".join(chunks)
    finally:
        destroy_context(context)
        destroy_surface(surface)


try:
    images = {size: png(size) for size in (16, 24, 32, 48, 64, 128, 256, 512, 1024)}
finally:
    release_svg(svg)

for name in ("icon.png", "icon-dev.png"):
    (root / name).write_bytes(images[1024])

public = root.parents[1] / "app" / "public"
for size in (16, 32):
    for suffix in ("", "-dark", "-dev"):
        (public / f"favicon-{size}x{size}{suffix}.png").write_bytes(images[size])

icns = b"".join(
    kind + struct.pack(">I", len(images[size]) + 8) + images[size]
    for kind, size in ((b"icp4", 16), (b"icp5", 32), (b"icp6", 64), (b"ic07", 128), (b"ic08", 256), (b"ic09", 512), (b"ic10", 1024))
)
(root / "icon.icns").write_bytes(b"icns" + struct.pack(">I", len(icns) + 8) + icns)

sizes = (16, 24, 32, 48, 64, 128, 256)
offset = 6 + 16 * len(sizes)
entries = []
for size in sizes:
    entries.append(struct.pack("<BBBBHHII", size % 256, size % 256, 0, 0, 1, 32, len(images[size]), offset))
    offset += len(images[size])
(root / "icon.ico").write_bytes(
    struct.pack("<HHH", 0, 1, len(sizes)) + b"".join(entries) + b"".join(images[size] for size in sizes)
)
