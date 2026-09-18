"""Render a marketing demo video from the static POS screenshots.

The screenshots are never modified: the script only moves a virtual camera over
them and draws video overlays (spotlight, focus ring, cursor, captions).
"""
import math
import os
import subprocess
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont
import imageio_ffmpeg

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
P1 = os.path.join(ROOT, "SCREENS", "phase-1-screens")
P2 = os.path.join(ROOT, "SCREENS", "phase-2-screens")
OUT_DIR = os.path.join(ROOT, "SCREENS", "demo")
TMP_DIR = os.path.join(OUT_DIR, "_scenes")

W, H = 1920, 1080
FPS = 30
XFADE = 0.5

FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()

BLUE = (37, 99, 235)
DARK = (10, 16, 32)
WHITE = (255, 255, 255)

FONTS = "C:/Windows/Fonts/"


def font(name, size):
    return ImageFont.truetype(FONTS + name, size)


F_TITLE = font("segoeuib.ttf", 74)
F_SUB = font("segoeui.ttf", 36)
F_CAP = font("segoeuib.ttf", 46)
F_CAPSUB = font("segoeui.ttf", 30)
F_TAG = font("segoeuib.ttf", 26)
F_BIG = font("segoeuib.ttf", 108)
F_MID = font("segoeuib.ttf", 40)


def ease(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


def ease_out_back(t):
    t = max(0.0, min(1.0, t))
    c1, c3 = 1.70158, 2.70158
    return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2


MIN_CAM_W = 880  # never zoom closer than this many source pixels wide


def fit_rect(rect, iw, ih, ar=W / H):
    """Expand a region of interest to the video aspect ratio, kept inside the image."""
    x0, y0, x1, y1 = rect
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    w, h = max(x1 - x0, 40), max(y1 - y0, 40)
    if w < MIN_CAM_W:
        w = MIN_CAM_W
    if w / h < ar:
        w = h * ar
    else:
        h = w / ar
    if w > iw:
        w, h = iw, iw / ar
    if h > ih:
        h, w = ih, ih * ar
    x0 = min(max(cx - w / 2, 0), iw - w)
    y0 = min(max(cy - h / 2, 0), ih - h)
    return [x0, y0, x0 + w, y0 + h]


def lerp_rect(a, b, t):
    return [a[i] + (b[i] - a[i]) * t for i in range(4)]


def pad_rect(rect, pad):
    return [rect[0] - pad, rect[1] - pad, rect[2] + pad, rect[3] + pad]


def to_screen(rect, cam):
    sx = W / (cam[2] - cam[0])
    sy = H / (cam[3] - cam[1])
    return [(rect[0] - cam[0]) * sx, (rect[1] - cam[1]) * sy,
            (rect[2] - cam[0]) * sx, (rect[3] - cam[1]) * sy]


def to_screen_pt(pt, cam):
    sx = W / (cam[2] - cam[0])
    sy = H / (cam[3] - cam[1])
    return ((pt[0] - cam[0]) * sx, (pt[1] - cam[1]) * sy)


def spotlight(base, rects, alpha):
    """Dim everything except the focus rects."""
    if alpha <= 0.01 or not rects:
        return base
    mask = Image.new("L", (W, H), int(255 * alpha))
    md = ImageDraw.Draw(mask)
    for r in rects:
        md.rounded_rectangle([int(v) for v in pad_rect(r, 10)], radius=22, fill=0)
    mask = mask.filter(ImageFilter.GaussianBlur(16))
    shade = Image.new("RGB", (W, H), DARK)
    return Image.composite(shade, base, mask)


def focus_ring(base, rect, prog):
    """Animated ring with a soft outer glow and a scale 'pop'."""
    if prog <= 0:
        return base
    grow = 1.0 + 0.05 * (1 - ease_out_back(min(prog / 0.35, 1.0)))
    cx, cy = (rect[0] + rect[2]) / 2, (rect[1] + rect[3]) / 2
    hw, hh = (rect[2] - rect[0]) / 2 * grow, (rect[3] - rect[1]) / 2 * grow
    r = [cx - hw, cy - hh, cx + hw, cy + hh]
    pulse = 0.5 + 0.5 * math.sin(prog * 4.2)
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    for i, a in ((16, 40), (10, 70), (5, 120)):
        gd.rounded_rectangle([int(v) for v in pad_rect(r, i)], radius=26 + i,
                             outline=BLUE + (int(a * (0.6 + 0.4 * pulse)),), width=6)
    glow = glow.filter(ImageFilter.GaussianBlur(9))
    out = Image.alpha_composite(base.convert("RGBA"), glow)
    d = ImageDraw.Draw(out)
    d.rounded_rectangle([int(v) for v in pad_rect(r, 4)], radius=22,
                        outline=BLUE + (int(235 * min(prog / 0.25, 1.0)),), width=5)
    return out.convert("RGB")


def cursor(base, pos, click_prog):
    x, y = pos
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    if click_prog is not None and 0 <= click_prog <= 1:
        rad = 26 + 120 * ease(click_prog)
        a = int(190 * (1 - click_prog))
        d.ellipse([x - rad, y - rad, x + rad, y + rad], outline=BLUE + (a,), width=7)
        d.ellipse([x - rad * 0.55, y - rad * 0.55, x + rad * 0.55, y + rad * 0.55],
                  fill=BLUE + (int(a * 0.22),))
    scale = 1.0
    if click_prog is not None and click_prog < 0.18:
        scale = 0.84 + 0.16 * (click_prog / 0.18)
    pts = [(0, 0), (0, 34), (9, 26), (15, 40), (22, 36), (16, 23), (27, 22)]
    shadow = [(x + px * scale + 3, y + py * scale + 4) for px, py in pts]
    arrow = [(x + px * scale, y + py * scale) for px, py in pts]
    d.polygon(shadow, fill=(0, 0, 0, 90))
    d.polygon(arrow, fill=(255, 255, 255, 255), outline=(25, 32, 52, 255))
    return Image.alpha_composite(base.convert("RGBA"), layer).convert("RGB")


def caption(base, title, sub, prog, out_prog=1.0):
    if not title:
        return base
    a = ease(min(prog / 0.45, 1.0)) * ease(min(out_prog / 0.35, 1.0))
    if a <= 0.01:
        return base
    slide = int(46 * (1 - a))
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    tw = d.textlength(title, font=F_CAP)
    sw = d.textlength(sub, font=F_CAPSUB) if sub else 0
    bw = int(max(tw, sw) + 96)
    bh = 168 if sub else 116
    x0, y0 = 96, H - 120 - bh + slide
    d.rounded_rectangle([x0, y0, x0 + bw, y0 + bh], radius=26,
                        fill=(8, 14, 30, int(215 * a)))
    d.rounded_rectangle([x0, y0, x0 + 8, y0 + bh], radius=4, fill=BLUE + (int(255 * a),))
    d.text((x0 + 44, y0 + 30), title, font=F_CAP, fill=WHITE + (int(255 * a),))
    if sub:
        d.text((x0 + 44, y0 + 96), sub, font=F_CAPSUB, fill=(176, 192, 224, int(255 * a)))
    return Image.alpha_composite(base.convert("RGBA"), layer).convert("RGB")


def progress_bar(base, frac):
    d = ImageDraw.Draw(base)
    d.rectangle([0, H - 7, W, H], fill=(226, 232, 240))
    d.rectangle([0, H - 7, int(W * max(0.0, min(1.0, frac))), H], fill=BLUE)
    return base


# --------------------------------------------------------------------------
# scene scripts: rects are in source-screenshot pixel space (1536x1024)
# --------------------------------------------------------------------------
FULL = [0, 0, 1536, 1024]

SCENES = [
    dict(kind="title"),
    dict(img=os.path.join(P1, "A1-Login.png"), beats=[
        dict(dur=2.4, rect=FULL, cap=("One login. Your entire store.",
                                      "POS, inventory, customers and B2B on a single platform")),
        dict(dur=3.0, rect=[890, 90, 1500, 900], cap=("Secure sign-in",
                                                      "Email, Google, Apple or Microsoft - with MFA"),
             boxes=[[927, 553, 1455, 613]], click=(1190, 583, 1.7)),
    ]),
    dict(img=os.path.join(P2, "Dashboard.png"), beats=[
        dict(dur=3.4, rect=FULL, cap=("Open the day already informed",
                                      "Live store dashboard - no reports to run")),
        dict(dur=3.8, rect=[260, 150, 1520, 300], cap=("Sales, bills, items - live",
                                                       "Compared against yesterday, automatically"),
             boxes=[[262, 163, 500, 292]]),
        dict(dur=3.8, rect=[700, 600, 1080, 880], cap=("Low-stock alerts before you lose a sale",
                                                       "Reorder levels watched for every SKU"),
             boxes=[[724, 612, 1064, 850]]),
    ]),
    dict(img=os.path.join(P2, "pos-checkout.png"), beats=[
        dict(dur=2.6, rect=FULL, cap=("Billing built for a busy counter",
                                      "Search, tap, take payment - done")),
        dict(dur=2.6, rect=[258, 120, 1140, 340], cap=("Find any style instantly",
                                                       "Name, SKU, barcode, brand or style code"),
             boxes=[[262, 138, 1128, 180]], click=(700, 158, 1.6)),
        dict(dur=2.4, rect=[258, 230, 1120, 600], cap=("Shop by category",
                                                       "Men, Women, Kids, Ethnic, Footwear, Offers"),
             boxes=[[258, 246, 344, 328]], click=(300, 286, 1.4)),
        dict(dur=2.8, rect=[258, 330, 830, 580], cap=("One tap adds the garment",
                                                      "Size, colour and live stock shown up front"),
             boxes=[[258, 340, 396, 572]], click=(327, 420, 1.6)),
        dict(dur=3.2, rect=[1145, 130, 1530, 560], cap=("Cart builds itself",
                                                        "Variant, quantity and price, no re-typing"),
             boxes=[[1152, 205, 1522, 540]]),
        dict(dur=3.0, rect=[1145, 560, 1530, 920], cap=("Cash, UPI, card or split",
                                                        "Quick-tender buttons settle the balance"),
             boxes=[[1158, 735, 1520, 800]], click=(1193, 779, 1.7)),
        dict(dur=3.4, rect=[1145, 800, 1530, 1010], cap=("Complete Sale - F8",
                                                         "Under 30 seconds from first scan to bill"),
             boxes=[[1158, 920, 1518, 970]], click=(1337, 945, 1.8)),
    ]),
    dict(img=os.path.join(P2, "bill details.png"), beats=[
        dict(dur=3.4, rect=[256, 180, 1200, 560], cap=("GST bill, ready instantly",
                                                       "Items, discount, tax and payments in one view"),
             boxes=[[256, 186, 1196, 288]]),
        dict(dur=3.0, rect=[860, 580, 1200, 830], cap=("Every rupee reconciled",
                                                       "Split payments tracked to the last balance"),
             boxes=[[872, 578, 1186, 812]]),
        dict(dur=3.2, rect=[256, 820, 790, 990], cap=("Send it the way the customer wants",
                                                      "Print, WhatsApp or email - one click"),
             boxes=[[596, 876, 752, 918]], click=(672, 897, 1.8)),
    ]),
    dict(img=os.path.join(P2, "inventory.png"), beats=[
        dict(dur=2.8, rect=FULL, cap=("Inventory that stays honest",
                                      "Stock, variants and movements across every store")),
        dict(dur=3.2, rect=[1020, 190, 1520, 300], cap=("Low stock and dead stock, surfaced",
                                                        "48 low, 12 out - before customers find out"),
             boxes=[[1026, 200, 1512, 292]]),
        dict(dur=3.6, rect=[1190, 350, 1530, 850], cap=("Full product truth in one panel",
                                                        "Cost, price, reserved, available, rack location"),
             boxes=[[1196, 356, 1516, 840]]),
    ]),
    dict(img=os.path.join(P2, "catloag.png"), beats=[
        dict(dur=3.0, rect=[258, 180, 700, 1010], cap=("Filter 1,120 styles in seconds",
                                                       "Category, brand, price, size, colour, tags"),
             boxes=[[264, 184, 472, 1000]]),
        dict(dur=3.0, rect=[490, 220, 1150, 1010], cap=("A catalogue that looks like your shop",
                                                        "Images, MRP, offer tag and live stock per style")),
        dict(dur=3.2, rect=[1150, 380, 1530, 800], cap=("12 variants, one product",
                                                        "No duplicate SKUs, no messy master data"),
             boxes=[[1160, 556, 1512, 640]]),
    ]),
    dict(img=os.path.join(P2, "customer(CRM).png"), beats=[
        dict(dur=3.0, rect=[258, 150, 1520, 300], cap=("Know who is actually buying",
                                                       "2,845 customers, segmented automatically"),
             boxes=[[262, 158, 1512, 245]]),
        dict(dur=3.2, rect=[1170, 300, 1530, 800], cap=("Every purchase, remembered",
                                                        "History, loyalty and notes on one card"),
             boxes=[[1180, 310, 1516, 790]], click=(1300, 640, 1.9)),
        dict(dur=2.8, rect=[1170, 780, 1530, 870], cap=("Turn a visit into a repeat sale",
                                                        "Start a billed sale straight from the profile"),
             boxes=[[1338, 808, 1504, 844]], click=(1420, 826, 1.6)),
    ]),
    dict(img=os.path.join(P2, "customer-due.png"), beats=[
        dict(dur=3.0, rect=[258, 140, 1520, 260], cap=("Khata, without the notebook",
                                                       "Outstanding dues tracked by ageing bucket"),
             boxes=[[262, 148, 1512, 245]]),
        dict(dur=3.2, rect=[262, 470, 1195, 880], cap=("See who owes, and for how long",
                                                       "Due soon and overdue, sorted for follow-up"),
             boxes=[[268, 530, 1188, 860]]),
        dict(dur=3.2, rect=[1030, 60, 1530, 420], cap=("Collect faster",
                                                       "WhatsApp, SMS or call reminders in one click"),
             boxes=[[1044, 78, 1168, 118]], click=(1106, 98, 1.8)),
    ]),
    dict(img=os.path.join(P2, "sales.png"), beats=[
        dict(dur=2.8, rect=FULL, cap=("Every sale, return and exchange",
                                      "Searchable by bill, customer, product or barcode")),
        dict(dur=2.8, rect=[258, 260, 1200, 360], cap=("Filter the way you think",
                                                       "Date range, store, payment mode, type"),
             boxes=[[262, 264, 1500, 302]]),
        dict(dur=3.2, rect=[1220, 300, 1530, 860], cap=("Reprint or return in seconds",
                                                        "Full bill context before you touch anything"),
             boxes=[[1232, 316, 1514, 846]], click=(1290, 822, 1.9)),
    ]),
    dict(kind="outro"),
]


def render_title(idx, dur):
    frames = []
    n = int(dur * FPS)
    logo = Image.open(os.path.join(P1, "A1-Login.png")).convert("RGB")
    for i in range(n):
        t = i / n
        bg = Image.new("RGB", (W, H), (7, 12, 28))
        d = ImageDraw.Draw(bg)
        for y in range(0, H, 4):
            k = y / H
            d.rectangle([0, y, W, y + 4], fill=(int(7 + 22 * k), int(12 + 34 * k), int(28 + 74 * k)))
        glow = Image.new("RGB", (W, H), (7, 12, 28))
        gd = ImageDraw.Draw(glow)
        gd.ellipse([W * 0.55, -260, W * 1.35, 620], fill=(24, 62, 150))
        bg = Image.blend(bg, glow.filter(ImageFilter.GaussianBlur(120)), 0.55)
        a = ease(min(t / 0.22, 1.0))
        layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        ld = ImageDraw.Draw(layer)
        ld.rounded_rectangle([160, 300, 700, 352], radius=26, fill=(37, 99, 235, int(70 * a)))
        ld.text((196, 312), "GARMENT RETAIL  -  WHOLESALE  -  B2B", font=F_TAG,
                fill=(147, 187, 255, int(255 * a)))
        slide = int(40 * (1 - a))
        ld.text((160, 400 + slide), "Run the whole shop", font=F_TITLE,
                fill=(255, 255, 255, int(255 * a)))
        a2 = ease(min(max(t - 0.12, 0) / 0.22, 1.0))
        ld.text((160, 492 + int(40 * (1 - a2))), "from one screen.", font=F_TITLE,
                fill=(96, 165, 250, int(255 * a2)))
        a3 = ease(min(max(t - 0.28, 0) / 0.25, 1.0))
        ld.text((160, 618), "Billing  |  Inventory  |  Khata  |  Customers  |  Reports",
                font=F_SUB, fill=(186, 201, 226, int(255 * a3)))
        bg = Image.alpha_composite(bg.convert("RGBA"), layer).convert("RGB")
        sc = 0.62 + 0.02 * t
        thumb = logo.resize((int(1536 * sc), int(1024 * sc)), Image.LANCZOS)
        card = Image.new("RGB", (thumb.width + 16, thumb.height + 16), (30, 58, 122))
        card.paste(thumb, (8, 8))
        bg.paste(card, (int(W - 720 + 140 * (1 - ease(min(t / 0.5, 1.0)))), 690))
        frames.append(progress_bar(bg, idx))
    return frames


def render_outro(dur):
    n = int(dur * FPS)
    frames = []
    bullets = [("30 sec", "average bill time"), ("1 tap", "to WhatsApp a bill"),
               ("0", "stock surprises"), ("1 screen", "for the whole business")]
    for i in range(n):
        t = i / n
        bg = Image.new("RGB", (W, H), (7, 12, 28))
        d = ImageDraw.Draw(bg)
        for y in range(0, H, 4):
            k = y / H
            d.rectangle([0, y, W, y + 4], fill=(int(7 + 20 * k), int(12 + 30 * k), int(28 + 68 * k)))
        layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        ld = ImageDraw.Draw(layer)
        a = ease(min(t / 0.2, 1.0))
        ld.text((160, 210), "Fewer clicks. Faster counters.", font=F_TITLE,
                fill=(255, 255, 255, int(255 * a)))
        ld.text((160, 300), "Happier customers.", font=F_TITLE, fill=(96, 165, 250, int(255 * a)))
        for j, (big, small) in enumerate(bullets):
            aj = ease(min(max(t - 0.18 - j * 0.09, 0) / 0.25, 1.0))
            x = 160 + j * 420
            ld.rounded_rectangle([x, 520, x + 380, 700], radius=24,
                                 fill=(255, 255, 255, int(16 * aj)))
            ld.text((x + 36, 556), big, font=F_MID, fill=(96, 165, 250, int(255 * aj)))
            ld.text((x + 36, 616), small, font=F_CAPSUB, fill=(198, 211, 232, int(255 * aj)))
        af = ease(min(max(t - 0.5, 0) / 0.3, 1.0))
        ld.text((160, 800), "AMBURAX POS", font=F_BIG, fill=(255, 255, 255, int(255 * af)))
        ld.text((166, 930), "Retail  |  Commerce  |  B2B  |  Powered by AI", font=F_SUB,
                fill=(147, 187, 255, int(255 * af)))
        bg = Image.alpha_composite(bg.convert("RGBA"), layer).convert("RGB")
        frames.append(progress_bar(bg, 1.0))
    return frames


def render_scene(scene, base_prog, span):
    img = Image.open(scene["img"]).convert("RGB")
    iw, ih = img.size
    beats = scene["beats"]
    cams = [fit_rect(b["rect"], iw, ih) for b in beats]
    total = sum(b["dur"] for b in beats)
    frames = []
    cursor_pos = None
    elapsed = 0.0
    for bi, beat in enumerate(beats):
        n = int(beat["dur"] * FPS)
        start_cam = cams[bi - 1] if bi else fit_rect(FULL, iw, ih)
        target = cams[bi]
        move = 0.0 if bi == 0 else 0.95
        boxes = beat.get("boxes", [])
        click = beat.get("click")
        for i in range(n):
            t = i / FPS
            if move > 0:
                cam = lerp_rect(start_cam, target, ease(t / move))
            else:
                cam = list(target)
            drift = 1.0 - 0.022 * ease(t / max(beat["dur"], 0.01))
            cx, cy = (cam[0] + cam[2]) / 2, (cam[1] + cam[3]) / 2
            hw, hh = (cam[2] - cam[0]) / 2 * drift, (cam[3] - cam[1]) / 2 * drift
            cam = [max(cx - hw, 0), max(cy - hh, 0), min(cx + hw, iw), min(cy + hh, ih)]
            frame = img.crop([int(round(v)) for v in cam]).resize((W, H), Image.LANCZOS)

            box_t = t - max(move, 0.25)
            scr_boxes = [to_screen(b, cam) for b in boxes]
            if scr_boxes and box_t > 0:
                frame = spotlight(frame, scr_boxes, 0.55 * ease(min(box_t / 0.4, 1.0)))
                for sb in scr_boxes:
                    frame = focus_ring(frame, sb, box_t)

            if click:
                cxp, cyp, ct = click
                target_pt = to_screen_pt((cxp, cyp), cam)
                if cursor_pos is None:
                    cursor_pos = (target_pt[0] - 340, target_pt[1] + 260)
                travel = max(min((t - (ct - 0.75)) / 0.75, 1.0), 0.0)
                pos = (cursor_pos[0] + (target_pt[0] - cursor_pos[0]) * ease(travel),
                       cursor_pos[1] + (target_pt[1] - cursor_pos[1]) * ease(travel))
                cp = None
                if t >= ct:
                    cp = min((t - ct) / 0.55, 1.0)
                    pos = target_pt
                if travel > 0:
                    frame = cursor(frame, pos, cp)
                if i == n - 1:
                    cursor_pos = target_pt

            cap = beat.get("cap")
            if cap:
                out_prog = (beat["dur"] - t) / 0.35 if bi == len(beats) - 1 else 1.0
                frame = caption(frame, cap[0], cap[1], t - 0.15, out_prog)
            frames.append(progress_bar(frame, base_prog + span * (elapsed + t) / total))
        elapsed += beat["dur"]
    return frames


def encode(frames, path):
    proc = subprocess.Popen(
        [FFMPEG, "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", str(W) + "x" + str(H),
         "-r", str(FPS), "-i", "-", "-an", "-c:v", "libx264", "-preset", "medium",
         "-crf", "18", "-pix_fmt", "yuv420p", path],
        stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for f in frames:
        proc.stdin.write(f.tobytes())
    proc.stdin.close()
    proc.wait()


def main():
    os.makedirs(TMP_DIR, exist_ok=True)
    durations = []
    for s in SCENES:
        if s.get("kind") == "title":
            durations.append(5.0)
        elif s.get("kind") == "outro":
            durations.append(5.5)
        else:
            durations.append(sum(b["dur"] for b in s["beats"]))
    grand = sum(durations) - XFADE * (len(SCENES) - 1)

    parts = []
    done = 0.0
    for i, scene in enumerate(SCENES):
        dur = durations[i]
        base = done / grand
        span = dur / grand
        print("scene %d/%d (%.1fs)" % (i + 1, len(SCENES), dur), flush=True)
        if scene.get("kind") == "title":
            frames = render_title(base, dur)
        elif scene.get("kind") == "outro":
            frames = render_outro(dur)
        else:
            frames = render_scene(scene, base, span)
        path = os.path.join(TMP_DIR, "s%02d.mp4" % i)
        encode(frames, path)
        parts.append((path, dur))
        done += dur - XFADE

    inputs = []
    for p, _ in parts:
        inputs += ["-i", p]
    filt, last, offset = [], "0:v", 0.0
    for i in range(1, len(parts)):
        offset += parts[i - 1][1] - XFADE
        out = "v%d" % i
        filt.append("[%s][%d:v]xfade=transition=fade:duration=%s:offset=%.3f[%s]"
                    % (last, i, XFADE, offset, out))
        last = out
    out_path = os.path.join(OUT_DIR, "amburax-pos-demo.mp4")
    cmd = [FFMPEG, "-y"] + inputs + ["-filter_complex", ";".join(filt),
                                     "-map", "[%s]" % last, "-c:v", "libx264", "-preset", "slow",
                                     "-crf", "19", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
                                     out_path]
    print("stitching...", flush=True)
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        print(r.stderr[-2500:])
        sys.exit(1)
    print("done:", out_path, "%.1fs" % grand)


if __name__ == "__main__":
    main()
