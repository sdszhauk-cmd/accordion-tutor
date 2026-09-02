#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Extract chord symbols from a vector (non-scanned) sheet-music PDF.

Engraved PDFs from MuseScore, Finale, Sibelius and friends keep chord symbols as
ordinary text, not as glyphs that have to be recognised.  That makes chord
extraction a layout problem rather than an OMR problem: read the text, read the
staff lines and barlines from the vector paths, and assign each chord to the
measure whose horizontal span contains it.

Output is the pipe-separated override string the Accordion Tutor's "Chords" box
accepts (one group per measure, "-" holds the previous chord), or JSON with the
full structure via --json.

    python scripts/extract_chords.py "zw_scores/Hungarian Dance No. 5.pdf"
    python scripts/extract_chords.py score.pdf --json
    python scripts/extract_chords.py score.pdf --debug

Requires PyMuPDF (`pip install pymupdf`).  Scanned PDFs are detected and
rejected - they need real OMR, which this deliberately is not.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter

try:
    import fitz  # PyMuPDF
except ImportError:  # pragma: no cover
    sys.stderr.write("PyMuPDF is required: pip install pymupdf\n")
    raise SystemExit(2)


# ── Tunables ────────────────────────────────────────────────────────────────
STAFF_LINE_MIN_WIDTH = 20.0   # a staff line is long and flat
STAFF_LINE_MAX_HEIGHT = 1.5
BARLINE_MAX_WIDTH = 3.0       # a barline is thin and tall
BARLINE_MIN_HEIGHT = 8.0
STAFF_GROUP_TOLERANCE = 2.0   # y values within this are the same staff line
STAFF_GAP = 40.0              # staves further apart than this start a new system
BARLINE_SPAN_SLACK = 2.0      # how loosely a vertical must match the staff span
# Chord symbols sit above the staff on single-staff lead sheets, but accordion
# grand staves put them between the treble and bass staves, so the search band
# has to cover the whole system, not just the space above it.
CHORD_BAND_ABOVE = 46.0
CHORD_BAND_BELOW = 14.0
MUSIC_FONT_HINTS = ("MScore", "Bravura", "Midisoft", "Maestro", "Opus", "Sonata",
                    "Emmentaler", "Gonville", "Petaluma", "Leland")

# ── Chord vocabulary ────────────────────────────────────────────────────────
# Mirrors preview.html's reduction: anything the Stradella board can play.
LETTER_RE = re.compile(
    r"^([A-G](?:#{1,2}|b{1,2})?)"
    r"((?:maj|Maj|M|m|mi|min|dim|aug|sus|add|alt|[0-9+\-#b°øΔ∆])*)"
    r"(?:/([A-G](?:#|b)?))?$"
)
# Spanish / Italian solfege naming, common in Latin-American accordion editions.
SOLFEGE = {
    "do": "C", "re": "D", "mi": "E", "fa": "F", "sol": "G", "la": "A", "si": "B",
    "ut": "C",
}
SOLFEGE_RE = re.compile(
    r"^(Do|Re|Mi|Fa|Sol|La|Si|Ut)(#|b)?"
    r"((?:m|min|maj|M|dim|aug|sus|add|[0-9+\-#b])*)"
    r"(?:/(Do|Re|Mi|Fa|Sol|La|Si|Ut)(#|b)?)?$",
    re.UNICODE,
)
# Words that would otherwise parse as chords.
NOT_CHORDS = {
    "A", "D.C", "DC", "DS", "Fine", "Fin", "FIN", "Coda", "Da", "Al", "Solo",
    "Bass", "Bajo", "Vivo", "Lento", "Rit", "Accordion", "Acordeon",
}


# An accidental beside a chord symbol is often a music-font glyph rather than a
# character, so "B" and "B-flat" look identical in the extracted text.  SMuFL
# fonts are standardised; legacy fonts are recorded from observed evidence.
SMUFL_ACCIDENTAL = {0xE260: "b", 0xE262: "#", 0xE261: ""}
LEGACY_ACCIDENTAL = {
    "MidisoftClassic": {"i": "b"},
}


def accidental_for(font_name: str, text: str):
    """Return the suffix this music glyph contributes, or None if unrecognised.

    Only glyphs with an unambiguous meaning are accepted - accidentals and the
    digits of an extension such as the 7 of "Em7".  Anything else (a notehead
    that merely happens to sit next to the text, say) returns None and is
    reported rather than guessed at, so a wrong chord is never invented.
    """
    if not text:
        return None
    ch = text[0]
    if ord(ch) in SMUFL_ACCIDENTAL:
        return SMUFL_ACCIDENTAL[ord(ch)]
    for family, table in LEGACY_ACCIDENTAL.items():
        if family in font_name and ch in table:
            return table[ch]
    if ch in ("b", "#"):        # chord fonts that spell the accidental literally
        return ch
    if ch.isdigit():            # the 7 of "Em7", set in the chord font
        return ch
    return None


def is_music_font(font_name: str) -> bool:
    return any(hint in font_name for hint in MUSIC_FONT_HINTS)


def normalize_letter(text: str):
    """'Gm' -> ('Gm', False).  Returns (chord, is_solfege) or None."""
    m = LETTER_RE.match(text)
    if not m:
        return None
    root, suffix, bass = m.group(1), m.group(2) or "", m.group(3)
    chord = root + suffix + ("/" + bass if bass else "")
    return chord


def normalize_solfege(text: str):
    """'Solm' -> 'Gm', 'Dom' -> 'Cm', 'Sib' -> 'Bb'."""
    m = SOLFEGE_RE.match(text)
    if not m:
        return None
    root = SOLFEGE[m.group(1).lower()] + (m.group(2) or "")
    suffix = m.group(3) or ""
    if suffix in ("M", "Maj", "maj"):      # "SolM" is just G major
        suffix = ""
    bass = ""
    if m.group(4):
        bass = "/" + SOLFEGE[m.group(4).lower()] + (m.group(5) or "")
    return root + suffix + bass


def looks_like_chord(text: str, notation: str):
    """Return the normalized chord, or None. `notation` is 'letter' or 'solfege'."""
    t = text.strip().replace("♭", "b").replace("♯", "#")
    t = t.rstrip(".,;:")
    if not t or len(t) > 10 or t in NOT_CHORDS:
        return None
    if not t[0].isupper():          # lowercase = bass-note hints, not chords
        return None
    if notation == "solfege":
        return normalize_solfege(t) or normalize_letter(t)
    return normalize_letter(t) or normalize_solfege(t)


def choose_layer(candidates):
    """Pick the (font, size) that carries the chord symbols.

    Engravings often hold two text layers: the chord symbols and a smaller
    layer of fingering or bass-button hints.  Both parse as chords, and mixing
    them produces two chords per measure.  Chord symbols are the larger of the
    two, so prefer size, then weight of evidence.
    """
    by_layer = {}
    for font, size, chord in candidates:
        by_layer.setdefault((font, round(size, 1)), 0)
        by_layer[(font, round(size, 1))] += 1
    strong = {k: v for k, v in by_layer.items() if v >= 3} or by_layer
    if not strong:
        return None
    return max(strong.items(), key=lambda kv: (kv[0][1], kv[1]))[0]


def detect_notation(candidates) -> str:
    """Pick letter vs solfege by which reading explains more of the text."""
    solfege_hits = sum(1 for c in candidates if normalize_solfege(c))
    letter_hits = sum(1 for c in candidates if normalize_letter(c))
    return "solfege" if solfege_hits > letter_hits else "letter"


# ── Geometry ────────────────────────────────────────────────────────────────
def collect_segments(page):
    """Split the page's vector paths into horizontal and vertical segments."""
    horizontals, verticals = [], []
    for path in page.get_drawings():
        for item in path["items"]:
            if item[0] == "l":
                p1, p2 = item[1], item[2]
                x0, y0, x1, y1 = p1.x, p1.y, p2.x, p2.y
            elif item[0] == "re":
                r = item[1]
                x0, y0, x1, y1 = r.x0, r.y0, r.x1, r.y1
            else:
                continue
            if x1 < x0:
                x0, x1 = x1, x0
            if y1 < y0:
                y0, y1 = y1, y0
            w, h = x1 - x0, y1 - y0
            if h <= STAFF_LINE_MAX_HEIGHT and w >= STAFF_LINE_MIN_WIDTH:
                horizontals.append((x0, x1, (y0 + y1) / 2))
            elif w <= BARLINE_MAX_WIDTH and h >= BARLINE_MIN_HEIGHT:
                verticals.append(((x0 + x1) / 2, y0, y1))
    return horizontals, verticals


def group_staves(horizontals):
    """Find five-line staves among the page's horizontal rules.

    Grouping purely by proximity is not enough: volta brackets, hairpins and
    8va lines are also long horizontal strokes, and one sitting near a staff
    gets swallowed into it, corrupting the staff's top edge and with it every
    barline test that depends on it.  Staff lines are distinguished by being
    *evenly* spaced, so the run is cut wherever the gap stops matching the
    page's modal line spacing.
    """
    if not horizontals:
        return []
    rows = {}
    for x0, x1, y in horizontals:
        key = next((k for k in rows if abs(k - y) <= STAFF_GROUP_TOLERANCE), None)
        if key is None:
            rows[y] = [x0, x1]
        else:
            rows[key][0] = min(rows[key][0], x0)
            rows[key][1] = max(rows[key][1], x1)
    ys = sorted(rows)
    if len(ys) < 5:
        return []

    gaps = [round(ys[i + 1] - ys[i], 1) for i in range(len(ys) - 1)]
    plausible = [g for g in gaps if 1.0 <= g <= 20.0]
    spacing = Counter(plausible).most_common(1)[0][0] if plausible else 5.0
    tolerance = max(0.8, spacing * 0.3)

    runs, run = [], [ys[0]]
    for y in ys[1:]:
        if abs(y - run[-1] - spacing) <= tolerance:
            run.append(y)
        else:
            runs.append(run)
            run = [y]
    runs.append(run)

    out = []
    for run in runs:
        # Exactly five lines make a staff; a longer even run is a staff plus an
        # artifact that happened to land on the grid, so consume it five at a time.
        for start in range(0, len(run) - 4, 5):
            chunk = run[start:start + 5]
            x0 = min(rows[y][0] for y in chunk)
            x1 = max(rows[y][1] for y in chunk)
            out.append({"top": chunk[0], "bottom": chunk[-1], "lines": chunk,
                        "x0": x0, "x1": x1})
    out.sort(key=lambda st: st["top"])
    return out


def group_systems(staves):
    """A system is the set of staves braced together (accordion: treble + bass)."""
    if not staves:
        return []
    systems, current = [], [staves[0]]
    for st in staves[1:]:
        if st["top"] - current[-1]["bottom"] > STAFF_GAP:
            systems.append(current)
            current = [st]
        else:
            current.append(st)
    systems.append(current)

    out = []
    for group in systems:
        out.append({
            "staves": group,
            "top": min(s["top"] for s in group),
            "bottom": max(s["bottom"] for s in group),
            "x0": min(s["x0"] for s in group),
            "x1": max(s["x1"] for s in group),
        })
    return out


def barlines_for_system(system, verticals):
    """Verticals that span a full staff (or the whole system) are barlines.

    Note stems are also thin verticals, but they are shorter than a staff and
    usually start or end inside it, so the span test separates them cleanly.
    """
    # On a grand staff the barline runs through every staff, so require the
    # full-system span; a note stem can span one staff exactly and would
    # otherwise be counted as a barline.  Single-staff systems fall back to the
    # staff itself, where the two spans are the same thing anyway.
    if len(system["staves"]) > 1:
        spans = [(system["top"], system["bottom"])]
    else:
        spans = [(system["top"], system["bottom"]),
                 (system["staves"][0]["top"], system["staves"][0]["bottom"])]
    hits = []
    for x, y0, y1 in verticals:
        for top, bottom in spans:
            if abs(y0 - top) <= BARLINE_SPAN_SLACK and abs(y1 - bottom) <= BARLINE_SPAN_SLACK:
                hits.append(x)
                break
    # collapse double barlines / repeat signs drawn as two close verticals
    hits.sort()
    merged = []
    for x in hits:
        if merged and x - merged[-1] < 6.0:
            merged[-1] = x
        else:
            merged.append(x)
    return merged


def measures_for_system(system, verticals, expected=None):
    """Return [(x_start, x_end)] for each measure in this system.

    When the engraved measure numbers say how many measures the system should
    hold, that count wins: a spurious barline shows up as an abnormally narrow
    measure, so merge the narrowest neighbours until the counts agree; a missed
    barline shows up as an over-wide measure, so split the widest.
    """
    bars = barlines_for_system(system, verticals)
    left, right = system["x0"], system["x1"]
    edges = [left] + [x for x in bars if left + 4 < x < right - 1] + [right]
    edges = sorted(set(round(e, 1) for e in edges))

    if expected and expected > 0:
        while len(edges) - 1 > expected and len(edges) > 2:
            widths = [edges[i + 1] - edges[i] for i in range(len(edges) - 1)]
            drop = widths.index(min(widths))
            # remove the edge bounding the narrowest measure, keeping the ends
            edges.pop(drop + 1 if drop + 1 < len(edges) - 1 else drop)
        while len(edges) - 1 < expected:
            widths = [edges[i + 1] - edges[i] for i in range(len(edges) - 1)]
            widest = widths.index(max(widths))
            edges.insert(widest + 1, round((edges[widest] + edges[widest + 1]) / 2, 1))

    return [(edges[i], edges[i + 1]) for i in range(len(edges) - 1)]


# ── Text ────────────────────────────────────────────────────────────────────
MEASURE_NUMBER_RE = re.compile(r"^\d{1,3}$")


def system_start_numbers(systems, spans):
    """Engraved measure numbers sit just left of, and above, each system.

    They are the one independent check available on the barline segmentation:
    the gap between consecutive numbers is how many measures a system should
    hold.  Returns {system_index: printed_number}.
    """
    found = {}
    for i, system in enumerate(systems):
        best = None
        for sp in spans:
            if not MEASURE_NUMBER_RE.match(sp["text"]):
                continue
            if sp["x"] > system["x0"] + 70:          # near the left edge
                continue
            if not (system["top"] - 30 <= sp["y1"] <= system["top"] + 8):
                continue
            if best is None or sp["x"] < best["x"]:
                best = sp
        if best is not None:
            found[i] = int(best["text"])
    return found


def collect_text_spans(page):
    """Non-music-font text spans with their positions."""
    spans = []
    unknown_glyphs = []
    for block in page.get_text("dict")["blocks"]:
        for line in block.get("lines", []):
            raw = line.get("spans", [])
            for i, sp in enumerate(raw):
                text = sp["text"].strip()
                if not text or is_music_font(sp["font"]):
                    continue
                x0, y0, x1, y1 = sp["bbox"]
                # A music glyph hard up against the text is its accidental.
                accidental = ""
                for nxt in raw[i + 1:]:
                    if nxt["bbox"][0] - x1 > 12:
                        break
                    if is_music_font(nxt["font"]) and nxt["text"].strip():
                        found = accidental_for(nxt["font"], nxt["text"].strip())
                        if found is not None:
                            accidental = found
                        else:
                            unknown_glyphs.append(
                                "%s U+%04X" % (nxt["font"], ord(nxt["text"].strip()[0])))
                    break
                spans.append({"text": text, "accidental": accidental,
                              "x": x0, "y": y0, "y1": y1,
                              "size": sp["size"], "font": sp["font"]})
    return spans, unknown_glyphs


def extract(pdf_path, notation="auto", debug=False, layer=None):
    doc = fitz.open(pdf_path)
    pages = []
    all_candidates = []
    unknown_glyphs = []

    for pno in range(doc.page_count):
        page = doc[pno]
        horizontals, verticals = collect_segments(page)
        systems = group_systems(group_staves(horizontals))
        spans, unknown = collect_text_spans(page)
        unknown_glyphs.extend(unknown)
        for sp in spans:
            if len(sp["text"]) <= 10 and sp["text"][:1].isupper():
                all_candidates.append(sp["text"])
        pages.append({"no": pno, "systems": systems, "verticals": verticals,
                      "spans": spans, "scanned": not horizontals})

    if all(p["scanned"] for p in pages):
        doc.close()
        raise ValueError(
            "No staff lines found as vector paths - this looks like a scanned PDF. "
            "Chord text extraction only works on engraved/vector PDFs; use OMR instead."
        )

    if notation == "auto":
        notation = detect_notation(all_candidates)

    # Which of the page's text layers actually carries the chord symbols?
    layer_candidates = []
    for page in pages:
        for system in page["systems"]:
            lo = system["top"] - CHORD_BAND_ABOVE
            hi = system["bottom"] + CHORD_BAND_BELOW
            for sp in page["spans"]:
                if lo <= sp["y1"] <= hi and looks_like_chord(sp["text"], notation):
                    layer_candidates.append((sp["font"], sp["size"], sp["text"]))
    chord_layer = layer if layer else choose_layer(layer_candidates)

    measures = []           # flat, in reading order
    unplaced = []
    system_sizes = []
    printed_numbers = []
    system_index = 0

    # Pass 1: read the engraved measure numbers for every system on every page,
    # so each system's expected length is known before its barlines are cut.
    for page in pages:
        nums = system_start_numbers(page["systems"], page["spans"])
        for i in range(len(page["systems"])):
            printed_numbers.append(nums.get(i))
    expected_sizes = []
    for i, n in enumerate(printed_numbers):
        nxt = printed_numbers[i + 1] if i + 1 < len(printed_numbers) else None
        expected_sizes.append(
            nxt - n if (n is not None and nxt is not None and nxt > n) else None)

    # Pass 2: cut each system into measures and place the chords.
    for page in pages:
        for system in page["systems"]:
            band_top = system["top"] - CHORD_BAND_ABOVE
            band_bottom = system["bottom"] + CHORD_BAND_BELOW
            spans_here = [sp for sp in page["spans"]
                          if band_top <= sp["y1"] <= band_bottom]
            chords_here = []
            for sp in spans_here:
                if chord_layer and (sp["font"], round(sp["size"], 1)) != chord_layer:
                    continue
                # try the symbol with its engraved accidental first
                chord = looks_like_chord(sp["text"] + sp.get("accidental", ""), notation)
                if chord is None:
                    chord = looks_like_chord(sp["text"], notation)
                if chord:
                    chords_here.append({"x": sp["x"], "raw": sp["text"], "chord": chord})
            spans_in_system = measures_for_system(
                system, page["verticals"], expected_sizes[system_index])
            system_index += 1
            system_sizes.append(len(spans_in_system))
            for span in spans_in_system:
                measures.append({"page": page["no"], "x0": span[0], "x1": span[1],
                                 "top": system["top"], "chords": []})
            # assign each chord to the measure containing its x
            system_measures = [m for m in measures if m["top"] == system["top"]
                               and m["page"] == page["no"]]
            for c in sorted(chords_here, key=lambda c: c["x"]):
                target = None
                for m in system_measures:
                    if m["x0"] - 6 <= c["x"] < m["x1"]:
                        target = m
                        break
                if target is None and system_measures:
                    target = min(system_measures, key=lambda m: abs(m["x0"] - c["x"]))
                if target is None:
                    unplaced.append(c)
                else:
                    target["chords"].append(c["chord"])

    doc.close()

    # Compare barline-derived system lengths against the engraved numbers.
    mismatches = []
    for i in range(len(system_sizes) - 1):
        a, b = printed_numbers[i], printed_numbers[i + 1]
        if a is None or b is None or b <= a:
            continue
        if b - a != system_sizes[i]:
            mismatches.append({"system": i, "printed_span": b - a,
                               "detected": system_sizes[i]})

    total_chords = sum(len(m["chords"]) for m in measures)
    return {
        "chord_layer": list(chord_layer) if chord_layer else None,
        "unknown_glyphs": sorted(set(unknown_glyphs)),
        "system_sizes": system_sizes,
        "printed_numbers": printed_numbers,
        "measure_mismatches": mismatches,
        "pdf": pdf_path,
        "notation": notation,
        "pages": len(pages),
        "measures": len(measures),
        "chords_found": total_chords,
        "measures_with_chords": sum(1 for m in measures if m["chords"]),
        "unplaced": [c["raw"] for c in unplaced],
        "measure_chords": [m["chords"] for m in measures],
        "debug": None if not debug else {
            "systems_per_page": [len(p["systems"]) for p in pages],
        },
    }


def override_string(measure_chords):
    """Render the app's Chords-box format: one group per measure, '-' holds."""
    return " | ".join(" ".join(ch) if ch else "-" for ch in measure_chords)


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("pdf")
    ap.add_argument("--json", action="store_true", help="emit structured JSON")
    ap.add_argument("--notation", choices=["auto", "letter", "solfege"], default="auto")
    ap.add_argument("--debug", action="store_true")
    ap.add_argument("--layer", help="force a text layer as 'Font:size'; see the "
                                    "chord layer line in the report")
    args = ap.parse_args()

    forced = None
    if args.layer:
        name, _, size = args.layer.rpartition(":")
        forced = (name, round(float(size), 1))

    try:
        result = extract(args.pdf, notation=args.notation, debug=args.debug,
                         layer=forced)
    except ValueError as exc:
        sys.stderr.write("%s\n" % exc)
        raise SystemExit(1)

    result["override"] = override_string(result["measure_chords"])

    if args.json:
        sys.stdout.write(json.dumps(result, indent=2))
        sys.stdout.write("\n")
        return

    out = sys.stdout
    out.write("%s\n" % result["pdf"])
    out.write("  notation      : %s\n" % result["notation"])
    out.write("  pages         : %d\n" % result["pages"])
    out.write("  measures      : %d\n" % result["measures"])
    out.write("  chords found  : %d in %d measures\n"
              % (result["chords_found"], result["measures_with_chords"]))
    if result["chord_layer"]:
        out.write("  chord layer   : %s %.1fpt" % (result["chord_layer"][0],
                                                   result["chord_layer"][1]) + chr(10))
    if result["unknown_glyphs"]:
        out.write("  unknown glyph : %s" % ", ".join(result["unknown_glyphs"][:6]) + chr(10))
    if result["unplaced"]:
        out.write("  unplaced      : %s\n" % ", ".join(result["unplaced"]))
    printed = [n for n in result["printed_numbers"] if n is not None]
    if printed:
        bad = result["measure_mismatches"]
        out.write("  measure check : %d systems carry engraved numbers; %s\n"
                  % (len(printed),
                     "all agree" if not bad
                     else "%d disagree -> %s" % (len(bad), bad[:4])))
    else:
        out.write("  measure check : no engraved measure numbers to check against\n")
    if args.debug and result["debug"]:
        out.write("  systems/page  : %s\n" % result["debug"]["systems_per_page"])
        out.write("  measures/sys  : %s\n" % result["system_sizes"])
        out.write("  printed nums  : %s\n" % result["printed_numbers"])
    out.write("\n%s\n" % result["override"])


if __name__ == "__main__":
    main()
