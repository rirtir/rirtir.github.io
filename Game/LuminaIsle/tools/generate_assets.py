"""Generate the deterministic pixel-art atlas for Lumina Isle.

The source is intentionally code-owned: collision silhouettes, animation frames and
palette remain stable even when the title illustration is regenerated.
"""

from __future__ import annotations

import json
from pathlib import Path
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
OUT_IMAGE = ROOT / "assets" / "sprites.png"
OUT_JSON = ROOT / "assets" / "sprites.json"
OUT_JS = ROOT / "assets" / "sprites.js"

C = {
    "ink": "#27324D", "ink2": "#46506A", "cream": "#FFF4C7",
    "sun": "#FFD166", "orange": "#F7A24B", "coral": "#EF6A67",
    "grass": "#93D96B", "leaf": "#4FAF72", "deep": "#34726B",
    "mint": "#72D6B3", "water": "#71DCE1", "sea": "#4BAAC8",
    "sky": "#8ACCF2", "lav": "#A99BE8", "night": "#6C73A8",
    "soil": "#C98B5B", "sand": "#F4D58D", "rock": "#9DA7B8",
    "copper": "#D87951", "white": "#FFFDF0", "clear": (0, 0, 0, 0),
}


def canvas(w=16, h=16, fill=C["clear"]):
    return Image.new("RGBA", (w, h), fill)


def px(draw, points, color):
    for x, y in points:
        draw.point((x, y), fill=color)


def tile(kind: str, variant=0):
    im = canvas()
    d = ImageDraw.Draw(im)
    if kind == "grass":
        d.rectangle((0, 0, 15, 15), fill=C["grass"])
        px(d, [((3 + variant * 3) % 14, 4), (11, (8 + variant * 2) % 14)], "#B7E77B")
        px(d, [(5, 12), (6, 11)], C["leaf"])
        if variant == 2:
            px(d, [(12, 3)], C["cream"])
    elif kind == "forest":
        d.rectangle((0, 0, 15, 15), fill="#78C778")
        px(d, [(2, 3), (8, 2), (13, 5), (4, 12), (11, 13)], C["leaf"])
        px(d, [(3, 4), (9, 3)], C["deep"])
    elif kind == "sand":
        d.rectangle((0, 0, 15, 15), fill=C["sand"])
        px(d, [(2 + variant, 4), (10, 2 + variant), (6, 12), (14, 9)], "#E6B96D")
        px(d, [(3 + variant, 4)], C["cream"])
    elif kind in ("water", "shallow"):
        base = C["water"] if kind == "shallow" else C["sea"]
        light = "#C7F3E9" if kind == "shallow" else "#80E7E1"
        d.rectangle((0, 0, 15, 15), fill=base)
        off = variant * 2
        for y, x in ((3, off - 6), (10, 8 - off)):
            d.line((x, y, x + 7, y), fill=light, width=1)
            d.point((x + 1, y + 1), fill=light)
    elif kind == "rock_ground":
        d.rectangle((0, 0, 15, 15), fill="#B8C0C8")
        d.line((1, 5, 5, 3), fill=C["rock"])
        d.line((10, 12, 14, 10), fill=C["lav"])
        px(d, [(8, 2), (3, 13)], C["cream"])
    elif kind == "dirt":
        d.rectangle((0, 0, 15, 15), fill="#D9A269")
        px(d, [(2, 4), (11, 3), (6, 11), (14, 9)], C["soil"])
    elif kind.startswith("tilled"):
        d.rectangle((0, 0, 15, 15), fill="#B67550" if kind == "tilled" else "#956F61")
        for x in (2, 6, 10, 14):
            d.line((x, 1, x, 14), fill="#7C594F", width=1)
    elif kind == "path":
        d.rectangle((0, 0, 15, 15), fill="#E2B875")
        d.rectangle((2, 2, 6, 6), fill=C["sand"])
        d.rectangle((9, 8, 14, 13), fill="#CCA067")
    elif kind == "wood_floor":
        d.rectangle((0, 0, 15, 15), fill="#DDA563")
        for y in (0, 7, 15): d.line((0, y, 15, y), fill="#9D6650")
        d.line((7, 0, 7, 7), fill="#B77A55")
    elif kind == "stone_floor":
        d.rectangle((0, 0, 15, 15), fill="#BEC6CD")
        d.line((0, 7, 15, 7), fill=C["rock"])
        d.line((7, 0, 7, 7), fill=C["rock"])
        d.line((4, 8, 4, 15), fill=C["rock"])
    return im


def item_icon(name: str):
    im = canvas()
    d = ImageDraw.Draw(im)
    if name == "branch":
        d.line((3, 12, 12, 3), fill=C["ink"], width=3); d.line((3, 11, 12, 2), fill="#B7784E")
        d.line((8, 7, 5, 4), fill=C["leaf"], width=2)
    elif name in ("wood", "resin"):
        d.rounded_rectangle((3, 3, 12, 13), 2, fill="#A86644", outline=C["ink"])
        d.ellipse((5, 4, 10, 9), outline=C["sand"])
        if name == "resin": d.ellipse((8, 8, 13, 14), fill=C["sun"], outline=C["ink"])
    elif name in ("stone", "ore", "crystal"):
        color = C["rock"] if name == "stone" else C["copper"] if name == "ore" else C["water"]
        pts = [(2, 11), (5, 3), (11, 2), (14, 8), (11, 13), (5, 14)]
        d.polygon(pts, fill=C["ink"]); d.polygon([(4, 10), (6, 4), (10, 4), (12, 8), (10, 11), (6, 12)], fill=color)
        d.line((6, 5, 10, 4), fill=C["cream"])
    elif name in ("fiber", "seed", "sunroot", "moonbean_seed", "moonbean", "tide_seed", "tide_melon", "herb"):
        d.line((8, 13, 8, 5), fill=C["deep"], width=2)
        leaf_col = C["lav"] if "moonbean" in name else C["water"] if "tide" in name else C["grass"]
        d.ellipse((3, 3, 8, 8), fill=leaf_col, outline=C["ink"])
        d.ellipse((8, 5, 13, 10), fill=C["leaf"], outline=C["ink"])
        if name == "sunroot": d.polygon([(6, 9), (11, 9), (9, 15)], fill=C["orange"], outline=C["ink"])
        elif name == "moonbean": d.ellipse((5, 9, 11, 14), fill=C["lav"], outline=C["ink"])
        elif name == "tide_melon": d.ellipse((4, 8, 12, 14), fill=C["water"], outline=C["ink"]); d.line((6, 9, 6, 13), fill=C["cream"])
    elif name in ("berry", "cooked_berry"):
        col = C["coral"] if name == "berry" else C["orange"]
        for x, y in ((5, 8), (9, 7), (7, 11)): d.ellipse((x-2, y-2, x+2, y+2), fill=col, outline=C["ink"])
        d.line((7, 5, 9, 2), fill=C["deep"], width=2)
    elif name == "fish" or name == "cooked_fish" or name.startswith("fish_"):
        fish_colors={"fish":C["water"],"fish_sun":C["orange"],"fish_moon":C["lav"],"fish_rain":C["sky"],"fish_rock":C["rock"],"fish_glow":C["sun"],"fish_leaf":C["leaf"],"fish_coral":C["coral"],"fish_star":C["night"],"fish_prism":C["lav"],"cooked_fish":C["orange"]}
        col = fish_colors[name]
        d.ellipse((3, 5, 12, 11), fill=col, outline=C["ink"]); d.polygon([(3, 8), (0, 4), (0, 12)], fill=col, outline=C["ink"])
        d.point((10, 7), fill=C["ink"])
        if name=="fish_sun": d.line((5,6,7,10),fill=C["cream"])
        elif name=="fish_moon": d.arc((5,6,9,10),80,280,fill=C["cream"])
        elif name=="fish_rain": d.point((7,7),fill=C["cream"]); d.point((5,9),fill=C["cream"])
        elif name=="fish_rock": d.rectangle((5,7,7,9),fill=C["copper"])
        elif name=="fish_glow": d.point((6,7),fill=C["white"]); d.point((8,9),fill=C["white"])
        elif name=="fish_leaf": d.line((5,9,8,6),fill=C["cream"])
        elif name=="fish_coral": d.rectangle((5,7,6,8),fill=C["sun"]); d.rectangle((8,8,9,9),fill=C["sun"])
        elif name=="fish_star": px(d,[(6,7),(5,8),(7,8),(6,9)],C["white"])
        elif name=="fish_prism": d.line((5,6,9,10),fill=C["sun"]); d.line((5,10,9,6),fill=C["water"])
    elif name in ("water", "shell"):
        if name == "water":
            d.polygon([(8, 1), (13, 9), (11, 14), (5, 14), (3, 9)], fill=C["water"], outline=C["ink"])
            d.line((6, 10, 7, 12), fill=C["cream"])
        else:
            d.pieslice((2, 3, 14, 15), 180, 360, fill=C["cream"], outline=C["ink"])
            for x in (5, 8, 11): d.line((8, 8, x, 13), fill=C["lav"])
    elif name in ("copper_bar", "light_shard"):
        col = C["copper"] if name == "copper_bar" else C["sun"]
        d.polygon([(2, 11), (5, 4), (12, 4), (14, 11)], fill=C["ink"])
        d.polygon([(4, 10), (6, 6), (11, 6), (12, 10)], fill=col)
        d.line((6, 6, 10, 6), fill=C["cream"])
    elif name.startswith("prism"):
        col = {"prism_forest": C["leaf"], "prism_tide": C["water"], "prism_rock": C["lav"]}.get(name, C["sun"])
        d.polygon([(8, 1), (14, 8), (8, 15), (2, 8)], fill=C["ink"])
        d.polygon([(8, 3), (12, 8), (8, 13), (4, 8)], fill=col)
        d.line((6, 7, 8, 4), fill=C["cream"])
    elif name in ("axe", "pickaxe", "spear", "rod", "watering_can", "hammer", "sun_axe", "sun_pickaxe", "sun_spear", "sun_rod", "sun_watering_can"):
        base = name.removeprefix("sun_")
        d.line((4, 13, 11, 4), fill=C["ink"], width=3); d.line((4, 13, 11, 4), fill="#B7784E")
        metal = C["sun"] if name.startswith("sun_") else C["rock"]
        if base == "axe": d.polygon([(8, 3), (14, 2), (13, 8), (10, 7)], fill=metal, outline=C["ink"])
        elif base == "pickaxe": d.line((6, 3, 14, 6), fill=C["ink"], width=3); d.line((7, 4, 13, 6), fill=metal)
        elif base == "spear": d.polygon([(11, 1), (15, 0), (14, 5)], fill=C["sun"] if name.startswith("sun_") else C["cream"], outline=C["ink"])
        elif base == "rod": d.arc((5, 1, 15, 11), 210, 355, fill=C["sun"] if name.startswith("sun_") else C["ink"], width=2); d.line((13, 6, 14, 13), fill=C["ink"])
        elif base == "watering_can": d.rounded_rectangle((2, 7, 11, 14), 2, fill=C["sun"] if name.startswith("sun_") else C["water"], outline=C["ink"]); d.line((10, 8, 15, 5), fill=C["ink"], width=2)
        else: d.rectangle((8, 2, 14, 7), fill=C["sun"], outline=C["ink"])
        if name.startswith("sun_"): d.point((3, 2), fill=C["cream"]); d.point((14, 10), fill=C["cream"])
    elif name in ("soup", "glow_skewer", "field_ration", "moon_tea", "tide_salad", "prism_stew"):
        d.ellipse((2, 6, 14, 14), fill=C["ink"]); d.ellipse((3, 6, 13, 11), fill=C["orange"])
        if name == "moon_tea": d.ellipse((3, 6, 13, 11), fill=C["lav"])
        elif name == "tide_salad": d.ellipse((3, 6, 13, 11), fill=C["water"])
        elif name == "prism_stew": d.ellipse((3, 6, 13, 11), fill=C["sun"]); d.point((6,8),fill=C["lav"]); d.point((10,8),fill=C["water"])
        d.line((5, 4, 11, 2), fill=C["cream"])
    elif name == "rope":
        d.ellipse((2, 2, 13, 13), outline=C["ink"], width=3); d.ellipse((4, 4, 11, 11), outline=C["sand"], width=2); d.line((10, 11, 14, 14), fill=C["ink"], width=2)
    else:
        d.rounded_rectangle((3, 3, 12, 12), 2, fill=C["sun"], outline=C["ink"])
    return im


def resource(name: str, frame=0):
    im = canvas(32, 48)
    d = ImageDraw.Draw(im)
    if name == "tree":
        d.ellipse((7, 39, 25, 44), fill=C["night"])
        d.rectangle((14, 23, 18, 40), fill=C["ink"]); d.rectangle((15, 23, 17, 40), fill="#A86644")
        sway = -1 if frame == 0 else 1
        d.ellipse((3+sway, 5, 22+sway, 27), fill=C["ink"])
        d.ellipse((11+sway, 2, 29+sway, 25), fill=C["ink"])
        d.ellipse((4+sway, 7, 20+sway, 23), fill=C["leaf"])
        d.ellipse((12+sway, 4, 27+sway, 22), fill=C["grass"])
        d.rectangle((10+sway, 7, 18+sway, 10), fill="#B8EA78")
    elif name == "berry_bush":
        d.ellipse((5, 24, 27, 43), fill=C["ink"]); d.ellipse((7, 22, 25, 40), fill=C["leaf"])
        for x,y in ((10,29),(20,27),(16,35)): d.rectangle((x,y,x+2,y+2), fill=C["coral"])
    elif name in ("rock", "ore", "crystal"):
        col = C["rock"] if name == "rock" else C["copper"] if name == "ore" else C["water"]
        d.ellipse((5, 37, 27, 44), fill=C["night"])
        pts=[(5,38),(9,23),(20,19),(28,31),(24,40),(10,41)]
        d.polygon(pts, fill=C["ink"]); d.polygon([(8,37),(11,25),(19,22),(25,31),(22,37),(11,39)], fill=col)
        d.line((11,26,19,23), fill=C["cream"])
    elif name == "fiber":
        for x in (9,14,19,23): d.line((16,42,x,26+(x%3)), fill=C["deep"], width=2)
        d.ellipse((6,37,26,44), fill=C["night"])
    elif name == "branch":
        d.ellipse((6,39,27,44), fill=C["night"]); d.line((7,39,25,26), fill=C["ink"], width=4); d.line((8,38,24,27), fill="#A86644", width=2)
    return im


DIRS = ["down", "down_right", "right", "up_right", "up", "up_left", "left", "down_left"]


def player(direction: str, frame=0, outfit="island"):
    """Hina v2: a readable 20x34 silhouette based on the approved character sheet."""
    im = canvas(20, 34)
    d = ImageDraw.Draw(im)
    outfits={"island":("#2CB9A8",C["sun"],C["coral"]),"grove":(C["leaf"],C["sun"],C["coral"]),"tide":(C["water"],C["coral"],C["sun"]),"starlight":(C["lav"],C["water"],C["coral"]),"keeper":(C["cream"],C["sun"],C["deep"])}
    overall,scarf,boots=outfits.get(outfit,outfits["island"])
    d.ellipse((2, 29, 18, 33), fill=C["night"])
    bob = 1 if frame in (1, 3) else 0
    # Coral boots, teal overalls and ivory sleeves.
    legs = ((5, 25+bob, 8, 30+bob), (12, 24+bob, 15, 29+bob)) if frame % 2 else ((5, 24+bob, 8, 29+bob), (12, 25+bob, 15, 30+bob))
    for box in legs: d.rectangle(box, fill=C["ink"]); d.rectangle((box[0],box[3]-2,box[2],box[3]), fill=boots)
    d.rounded_rectangle((3, 15+bob, 16, 27+bob), 3, fill=C["ink"])
    d.rectangle((4, 17+bob, 15, 26+bob), fill=overall)
    d.rectangle((2, 17+bob, 4, 23+bob), fill=C["white"]); d.rectangle((15, 17+bob, 17, 23+bob), fill=C["white"])
    d.rectangle((6, 16+bob, 7, 24+bob), fill=C["sun"]); d.rectangle((12, 16+bob, 13, 24+bob), fill=C["sun"])
    # Cross-body tool satchel strap remains visible from every direction.
    if "left" in direction: d.line((14, 16+bob, 6, 25+bob), fill=C["cream"], width=2)
    else: d.line((5, 16+bob, 13, 25+bob), fill=C["cream"], width=2)
    # Large chestnut hair mass and warm face create a distinct human silhouette.
    d.ellipse((1, 2+bob, 18, 18+bob), fill=C["ink"])
    d.ellipse((2, 3+bob, 17, 17+bob), fill="#7A4934")
    d.rectangle((1, 10+bob, 4, 17+bob), fill=C["ink"]); d.rectangle((15, 10+bob, 18, 17+bob), fill=C["ink"])
    d.line((9, 3+bob, 12, 0+bob), fill=C["ink"], width=3); d.line((9, 3+bob, 12, 1+bob), fill="#A86644", width=1)
    vx = 0 if "left" not in direction and "right" not in direction else (-1 if "left" in direction else 1)
    vy = -1 if direction.startswith("up") else (1 if direction.startswith("down") else 0)
    if vy >= 0:
        d.rounded_rectangle((5+vx, 7+bob, 14+vx, 16+bob), 3, fill="#B96F49")
        eye_y=11+bob
        if vx == 0: d.rectangle((7,eye_y,8,eye_y+1),fill=C["ink"]); d.rectangle((12,eye_y,13,eye_y+1),fill=C["ink"])
        else: d.rectangle((9+vx*2,eye_y,10+vx*2,eye_y+1),fill=C["ink"])
        d.point((10+vx,14+bob), fill=C["coral"])
    # Star hair clip and sunflower scarf are readable identity anchors.
    if direction not in ("up","up_left"):
        sx=14 if vx>=0 else 5; sy=7+bob; px(d,[(sx,sy),(sx-1,sy),(sx+1,sy),(sx,sy-1),(sx,sy+1)],C["sun"])
    d.rectangle((4, 15+bob, 15, 17+bob), fill=scarf)
    tail_left = vx >= 0
    if tail_left: d.polygon([(4,16+bob),(1,18+bob),(4,20+bob)],fill=scarf,outline=C["ink"])
    else: d.polygon([(15,16+bob),(18,18+bob),(15,20+bob)],fill=scarf,outline=C["ink"])
    return im


def enemy(name: str, frame=0):
    size = 32 if "warden" in name else 24
    im = canvas(size, size)
    d = ImageDraw.Draw(im)
    yoff = 1 if frame else 0
    d.ellipse((3, size-7, size-3, size-2), fill=C["night"])
    if name == "slime":
        d.rounded_rectangle((4, 7+yoff, size-5, size-6+yoff), 6, fill=C["ink"])
        d.rounded_rectangle((6, 9+yoff, size-7, size-7+yoff), 5, fill=C["grass"])
        d.ellipse((7, 2+yoff, 13, 9+yoff), fill=C["leaf"], outline=C["ink"]); d.ellipse((12, 1+yoff, 18, 8+yoff), fill="#B8EA78", outline=C["ink"])
        d.point((8, 14+yoff), fill=C["ink"]); d.point((15, 14+yoff), fill=C["ink"])
    elif name == "thorn":
        d.ellipse((4, 5+yoff, size-5, size-5+yoff), fill=C["ink"]); d.ellipse((6, 7+yoff, size-7, size-7+yoff), fill=C["orange"])
        for a,b in ((12,1),(12,23),(1,12),(23,12)): d.polygon([(a,b),(a-2 if a>12 else a+2,b+2),(a+2,b+2)], fill=C["lav"])
        d.point((9, 13), fill=C["ink"]); d.point((15, 13), fill=C["ink"])
    elif name == "crab":
        d.ellipse((4, 9+yoff, size-5, size-6+yoff), fill=C["ink"]); d.ellipse((6, 10+yoff, size-7, size-8+yoff), fill=C["water"])
        d.arc((1, 4, 11, 15), 80, 260, fill=C["cream"], width=2); d.arc((13,4,23,15),280,100,fill=C["cream"],width=2)
        d.point((9, 11), fill=C["ink"]); d.point((15, 11), fill=C["ink"])
    elif name == "rockling":
        d.polygon([(3,19),(6,7),(13,3),(21,9),(22,20),(17,23),(7,23)], fill=C["ink"])
        d.polygon([(6,18),(8,9),(13,6),(19,10),(19,19),(16,21),(8,21)], fill=C["rock"])
        d.rectangle((9,11,11,13),fill=C["sun"]); d.rectangle((15,11,17,13),fill=C["sun"])
    elif name == "forest_warden":
        d.ellipse((4,8,28,30),fill=C["ink"]); d.ellipse((6,10,26,27),fill="#A86644")
        d.line((8,12,3,2),fill=C["ink"],width=3); d.line((24,12,29,2),fill=C["ink"],width=3)
        d.ellipse((3,1,10,8),fill=C["grass"],outline=C["ink"]); d.ellipse((22,1,29,8),fill=C["leaf"],outline=C["ink"])
        d.rectangle((10,16,13,19),fill=C["mint"]); d.rectangle((20,16,23,19),fill=C["mint"])
    elif name == "stone_warden":
        d.ellipse((3,6,29,30),fill=C["ink"]); d.ellipse((6,9,26,27),fill=C["rock"])
        d.ellipse((9,1,23,15),fill=C["ink"]); d.ellipse((11,3,21,13),fill=C["lav"])
        for x,y in ((16,1),(23,8),(16,15),(9,8)): d.line((16,8,x,y),fill=C["sun"],width=2)
        d.rectangle((10,18,13,21),fill=C["sun"]); d.rectangle((19,18,22,21),fill=C["sun"])
    return im


def building(name: str, stage=0):
    w, h = (48, 64) if name == "lighthouse" else (32, 40)
    im = canvas(w, h)
    d = ImageDraw.Draw(im)
    d.ellipse((3, h-9, w-3, h-3), fill=C["night"])
    if name == "campfire":
        for x,y in ((9,31),(16,33),(23,31)): d.ellipse((x-4,y-3,x+4,y+2),fill=C["rock"],outline=C["ink"])
        d.line((9,31,23,23),fill=C["ink"],width=4); d.line((10,30,22,24),fill="#A86644",width=2)
        d.polygon([(16,31),(10,23),(16,10),(22,23)],fill=C["coral"],outline=C["ink"])
        d.polygon([(16,27),(13,22),(17,15),(20,23)],fill=C["sun"])
    elif name == "workbench":
        d.rectangle((4,16,28,25),fill=C["ink"]); d.rectangle((5,15,27,22),fill="#DDA563")
        d.rectangle((7,22,10,35),fill=C["ink"]); d.rectangle((22,22,25,35),fill=C["ink"])
        d.rectangle((8,12,20,16),fill=C["rock"],outline=C["ink"])
    elif name == "furnace":
        d.rounded_rectangle((5,8,27,35),5,fill=C["ink"]); d.rounded_rectangle((7,10,25,33),4,fill="#B5BECB")
        d.ellipse((10,20,22,32),fill=C["ink"]); d.rectangle((12,25,20,31),fill=C["orange"])
        d.rectangle((20,4,26,12),fill=C["ink"]); d.rectangle((22,5,24,10),fill=C["rock"])
    elif name == "chest":
        d.rounded_rectangle((4,16,28,34),3,fill=C["ink"]); d.rounded_rectangle((6,18,26,32),2,fill="#B7784E")
        d.line((6,23,26,23),fill=C["sun"],width=2); d.rectangle((14,22,18,28),fill=C["sun"],outline=C["ink"])
    elif name == "bed":
        d.rectangle((3,15,29,34),fill=C["ink"]); d.rectangle((5,17,27,32),fill=C["cream"])
        d.rectangle((5,17,27,23),fill=C["water"]); d.rectangle((5,24,27,32),fill=C["coral"])
    elif name == "well":
        d.ellipse((4,19,28,35),fill=C["ink"]); d.ellipse((6,18,26,31),fill=C["rock"]); d.ellipse((9,20,23,28),fill=C["water"])
        d.line((6,6,6,23),fill=C["ink"],width=3); d.line((26,6,26,23),fill=C["ink"],width=3); d.line((6,6,26,6),fill=C["ink"],width=3)
    elif name == "plot":
        d.rectangle((3,14,29,36),fill=C["ink"]); d.rectangle((5,16,27,34),fill="#B67550")
        for x in (9,15,21): d.line((x,18,x,32),fill="#7C594F")
    elif name == "lantern":
        d.rectangle((14,10,18,35),fill=C["ink"]); d.rectangle((15,11,17,35),fill="#A86644")
        d.rounded_rectangle((9,5,23,19),3,fill=C["ink"]); d.rectangle((11,7,21,17),fill=C["sun"]); d.rectangle((13,8,18,13),fill=C["cream"])
    elif name == "lighthouse":
        d.rectangle((12,18,36,58),fill=C["ink"]); d.rectangle((15,19,33,57),fill=C["cream"])
        d.rectangle((19,43,29,58),fill=C["deep"],outline=C["ink"])
        if stage >= 1: d.rectangle((8,51,40,59),fill=C["rock"],outline=C["ink"])
        if stage >= 2:
            d.rectangle((10,12,38,23),fill=C["copper"],outline=C["ink"]); d.rectangle((15,8,33,19),fill=C["water"],outline=C["ink"])
        if stage >= 3: d.polygon([(24,4),(31,12),(24,19),(17,12)],fill=C["sun"],outline=C["ink"])
        if stage >= 4:
            d.polygon([(24,10),(0,2),(0,9)],fill=(255,244,199,180)); d.polygon([(24,10),(48,2),(48,9)],fill=(255,209,102,180))
        d.rectangle((10,15,38,19),fill=C["ink"]); d.rectangle((11,14,37,17),fill=C["copper"])
    return im


class Atlas:
    def __init__(self, width=1024, height=1024):
        self.image = canvas(width, height)
        self.width, self.height = width, height
        self.x = self.y = 1
        self.row_h = 0
        self.data = {"meta": {"size": [width, height], "tile": 16, "palette": C}, "sprites": {}}

    def add(self, name, image, anchor=None):
        w, h = image.size
        if self.x + w + 1 > self.width:
            self.x = 1; self.y += self.row_h + 1; self.row_h = 0
        if self.y + h + 1 > self.height:
            raise RuntimeError("Atlas is full")
        self.image.alpha_composite(image, (self.x, self.y))
        self.data["sprites"][name] = {"x": self.x, "y": self.y, "w": w, "h": h,
                                      "anchor": anchor or [w // 2, h]}
        self.x += w + 1; self.row_h = max(self.row_h, h)

    def save(self):
        self.image.save(OUT_IMAGE, optimize=True)
        raw = json.dumps(self.data, ensure_ascii=False, separators=(",", ":"))
        OUT_JSON.write_text(raw, encoding="utf-8")
        OUT_JS.write_text("window.LI_SPRITES=" + raw + ";\n", encoding="utf-8")


def main():
    a = Atlas()
    for i in range(4): a.add(f"tile.grass.{i}", tile("grass", i), [0, 0])
    for i in range(2): a.add(f"tile.sand.{i}", tile("sand", i), [0, 0])
    for i in range(4): a.add(f"tile.water.{i}", tile("water", i), [0, 0])
    for i in range(4): a.add(f"tile.shallow.{i}", tile("shallow", i), [0, 0])
    for name in ("forest", "rock_ground", "dirt", "tilled", "tilled_wet", "path", "wood_floor", "stone_floor"):
        a.add(f"tile.{name}", tile(name), [0, 0])

    items = ("branch", "wood", "stone", "fiber", "berry", "seed", "resin", "shell", "fish", "cooked_fish",
             "water", "ore", "copper_bar", "crystal", "light_shard", "prism_forest", "prism_tide", "prism_rock",
             "axe", "pickaxe", "spear", "rod", "watering_can", "hammer", "sunroot", "cooked_berry", "soup", "glow_skewer",
             "fish_sun", "fish_moon", "fish_rain", "fish_rock", "fish_glow", "fish_leaf", "fish_coral", "fish_star", "fish_prism",
             "rope", "herb", "moonbean_seed", "moonbean", "tide_seed", "tide_melon", "field_ration", "moon_tea", "tide_salad", "prism_stew",
             "sun_axe", "sun_pickaxe", "sun_spear", "sun_rod", "sun_watering_can")
    for name in items: a.add(f"item.{name}", item_icon(name), [8, 8])

    for name in ("tree", "berry_bush", "rock", "ore", "crystal", "fiber", "branch"):
        for frame in range(2): a.add(f"resource.{name}.{frame}", resource(name, frame), [16, 43])

    for direction in DIRS:
        for frame in range(4): a.add(f"player.{direction}.{frame}", player(direction, frame), [10, 31])
    for outfit in ("grove", "tide", "starlight", "keeper"):
        for direction in DIRS:
            for frame in range(4): a.add(f"player.{outfit}.{direction}.{frame}", player(direction, frame, outfit), [10, 31])

    for name in ("slime", "thorn", "crab", "rockling", "forest_warden", "stone_warden"):
        for frame in range(2):
            img = enemy(name, frame); a.add(f"enemy.{name}.{frame}", img, [img.width // 2, img.height - 3])

    for name in ("campfire", "workbench", "furnace", "chest", "bed", "well", "plot", "lantern"):
        img = building(name); a.add(f"building.{name}", img, [img.width // 2, img.height - 4])
    for stage in range(5):
        img = building("lighthouse", stage); a.add(f"building.lighthouse.{stage}", img, [24, 59])

    a.save()
    print(f"wrote {OUT_IMAGE} ({OUT_IMAGE.stat().st_size} bytes)")
    print(f"wrote {OUT_JSON} ({len(a.data['sprites'])} sprites)")
    print(f"wrote {OUT_JS} (file:// atlas metadata)")


if __name__ == "__main__":
    main()
