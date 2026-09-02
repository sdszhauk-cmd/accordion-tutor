#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Extract notes (pitch + rhythm) from an engraved, vector sheet-music PDF.

This is the note-reading counterpart to `extract_chords.py`, and it works for
the same reason: an engraved PDF already contains every notehead as a placed
glyph, so reading the music is a geometry problem rather than image recognition.

The one trick that makes it work is to read each glyph's **origin** (via
PyMuPDF's `rawdict`) rather than its bounding box.  A music font's glyph box is
the font em box - about twice the height of a staff - so box centres are
useless for pitch.  Origins land exactly on the diatonic grid.

Nothing here is hard-coded to a particular music font.  Glyph roles are learned
per document from position: the leftmost glyph on a staff is its clef, the
clef's origin identifies which clef it is (a G clef sits on the G line, an F
clef on the F line), repeated accidentals straight after it are the key
signature, and the remaining glyphs on the diatonic grid are noteheads.

    python scripts/extract_notes.py "zw_scores/En las colinas de Manchuria. Vals ruso.pdf"
    python scripts/extract_notes.py score.pdf --musicxml out.musicxml
    python scripts/extract_notes.py score.pdf --check      # key-fit diagnostics
"""
from __future__ import annotations

import argparse
import collections
import copy
import json
import sys
import xml.etree.ElementTree as ET

try:
    import fitz  # PyMuPDF
except ImportError:  # pragma: no cover
    sys.stderr.write("PyMuPDF is required: pip install pymupdf\n")
    raise SystemExit(2)

sys.path.insert(0, __file__.rsplit("\\", 1)[0].rsplit("/", 1)[0])
from extract_chords import (  # noqa: E402
    collect_segments, group_staves, group_systems, measures_for_system,
    collect_text_spans, system_start_numbers, is_music_font,
)

LETTERS = "CDEFGAB"
# Order accidentals appear in a key signature, as diatonic letters.
SHARP_ORDER = "FCGDAEB"
FLAT_ORDER = "BEADGCF"
GRID_TOLERANCE = 0.9      # px: how close an origin must sit to the diatonic grid
CHORD_X_TOLERANCE = 3.0   # noteheads within this x are one chord


def diatonic_index(letter: str, octave: int) -> int:
    return LETTERS.index(letter) + 7 * octave


def from_diatonic(index: int):
    return LETTERS[index % 7], index // 7


def staff_geometry(staff):
    lines = staff["lines"]
    step = (lines[-1] - lines[0]) / 8.0     # one diatonic step = half a line gap
    return lines, step


def glyphs_on_page(page):
    """Every music-font glyph with its origin (not its bounding box)."""
    out = []
    for block in page.get_text("rawdict")["blocks"]:
        for line in block.get("lines", []):
            for span in line.get("spans", []):
                if not is_music_font(span["font"]):
                    continue
                for ch in span.get("chars", []):
                    c = ch.get("c") or ""
                    if not c.strip():
                        continue
                    ox, oy = ch["origin"]
                    out.append({"x": ox, "y": oy, "code": ord(c),
                                "font": span["font"], "size": span["size"]})
    out.sort(key=lambda g: (g["x"], g["y"]))
    return out


def collect_beams(page):
    """Beams, as filled polygons.

    Engravers draw a beam as a filled quadrilateral built from straight edges,
    which is what separates it from the two other filled shapes on the page: a
    slur is filled *curves*, and the brace joining a grand staff is tall and
    narrow.  Beams are the only rhythmic information that is not a glyph.
    """
    beams = []
    for path in page.get_drawings():
        if path.get("fill") is None or path.get("type") != "f":
            continue
        if set(it[0] for it in path["items"]) != {"l"}:
            continue
        r = path["rect"]
        if r.width < 4 or r.height > 8:      # excludes the staff brace
            continue
        beams.append((r.x0, r.x1, r.y0, r.y1))
    return beams


def detect_time_signature(staff, glyphs):
    """Read the engraved time signature: ASCII digits stacked at the staff head."""
    lines, step = staff_geometry(staff)
    middle = (lines[0] + lines[-1]) / 2.0
    digits = [g for g in glyphs
              if 0x30 <= g["code"] <= 0x39
              and staff["x0"] - 2 * step <= g["x"] <= staff["x0"] + 26 * step
              and staff["top"] - 2 * step <= g["y"] <= staff["bottom"] + 2 * step]
    upper = [g for g in digits if g["y"] < middle]
    lower = [g for g in digits if g["y"] >= middle]
    if not upper or not lower:
        return None
    beats = int(chr(min(upper, key=lambda g: g["x"])["code"]))
    beat_type = int(chr(min(lower, key=lambda g: g["x"])["code"]))
    return beats, beat_type


def stem_for(note_x, note_y, step, stems):
    """The stem attached to a notehead: touching its side, spanning from it."""
    best = None
    for vx, vy0, vy1 in stems:
        if abs(vx - note_x) > 1.6 * step:
            continue
        lo, hi = min(vy0, vy1), max(vy0, vy1)
        if not (lo - 1.2 * step <= note_y <= hi + 1.2 * step):
            continue
        length = hi - lo
        if best is None or length > best[2]:
            best = (lo, hi, length, vx)
    return best


def beam_count(stem, beams, step):
    """How many beams cross this stem - one for an eighth, two for a sixteenth."""
    if stem is None:
        return 0
    lo, hi, _, vx = stem
    n = 0
    for bx0, bx1, by0, by1 in beams:
        if not (bx0 - 0.6 * step <= vx <= bx1 + 0.6 * step):
            continue
        if by1 >= lo - 1.5 * step and by0 <= hi + 1.5 * step:
            n += 1
    return n


def classify_staff(staff, glyphs):
    """Learn this staff's clef and key signature from the glyphs at its left.

    Returns (clef_name, reference_index, accidentals) where reference_index is
    the diatonic index of the staff's top line and `accidentals` maps a letter
    to -1/+1 for the key signature.
    """
    lines, step = staff_geometry(staff)
    band = [g for g in glyphs if staff["top"] - 4 * step <= g["y"] <= staff["bottom"] + 4 * step]
    if not band:
        return None, None, {}
    band.sort(key=lambda g: g["x"])
    clef = band[0]

    # A G clef's origin sits on the G line (2nd from the bottom, index 3 from
    # the top); an F clef's on the F line (2nd from the top, index 1).
    def near(a, b):
        return abs(a - b) <= max(1.0, step * 0.6)

    if near(clef["y"], lines[3]):
        clef_name, top_line = "G", diatonic_index("F", 5)
    elif near(clef["y"], lines[1]):
        clef_name, top_line = "F", diatonic_index("A", 3)
    elif near(clef["y"], lines[2]):
        clef_name, top_line = "C", diatonic_index("G", 4)
    else:
        clef_name, top_line = "G", diatonic_index("F", 5)

    # Key signature: the run of same-codepoint glyphs immediately after the clef.
    accidentals = {}
    sig = []
    for g in band[1:]:
        if g["code"] == clef["code"]:
            continue
        if not sig:
            sig.append(g)
        elif g["code"] == sig[0]["code"] and g["x"] - sig[-1]["x"] < 4 * step:
            sig.append(g)
        else:
            break
    if sig:
        letters = [from_diatonic(top_line - round((g["y"] - lines[0]) / step))[0] for g in sig]
        # Sharps run F C G D A E B; flats run B E A D G C F.  Whichever order
        # the glyph positions follow tells us which accidental this glyph is.
        n = len(letters)
        if letters == list(SHARP_ORDER[:n]):
            accidentals = {L: 1 for L in letters}
        elif letters == list(FLAT_ORDER[:n]):
            accidentals = {L: -1 for L in letters}
        sig_code = sig[0]["code"]
    else:
        sig_code = None
    return clef_name, top_line, (accidentals, sig_code, len(sig))


def read_document(pdf_path):
    """Geometry pass: staves, systems, measures and glyphs for the whole file."""
    doc = fitz.open(pdf_path)
    systems_all = []
    for pno in range(doc.page_count):
        page = doc[pno]
        horizontals, verticals = collect_segments(page)
        systems = group_systems(group_staves(horizontals))
        if not systems:
            continue
        spans, _ = collect_text_spans(page)
        glyphs = glyphs_on_page(page)
        beams = collect_beams(page)
        numbers = system_start_numbers(systems, spans)
        for i, system in enumerate(systems):
            systems_all.append({"page": pno, "system": system, "glyphs": glyphs,
                                "verticals": verticals, "beams": beams,
                                "number": numbers.get(i)})
    doc.close()
    if not systems_all:
        raise ValueError("No staves found - this looks like a scanned PDF.")

    nums = [s["number"] for s in systems_all]
    expected = []
    for i, n in enumerate(nums):
        nxt = nums[i + 1] if i + 1 < len(nums) else None
        expected.append(nxt - n if (n is not None and nxt is not None and nxt > n) else None)
    for entry, exp in zip(systems_all, expected):
        entry["spans"] = measures_for_system(entry["system"], entry["verticals"], exp)
        entry["staff_info"] = []
        for staff in entry["system"]["staves"]:
            clef, top_line, sig = classify_staff(staff, entry["glyphs"])
            accidentals, sig_code, sig_len = sig if isinstance(sig, tuple) else ({}, None, 0)
            entry["staff_info"].append({"staff": staff, "clef": clef, "top_line": top_line,
                                        "key": accidentals, "sig_code": sig_code})
    return systems_all, nums


def grid_candidates(systems_all):
    """Every glyph code that sits on the diatonic grid, with role evidence.

    An accidental is recognisable without knowing the font: it sits immediately
    to the LEFT of a notehead at the SAME pitch.  That test is what separates
    sharps and flats from noteheads, both of which take many vertical positions.
    """
    items = []
    for entry in systems_all:
        for info in entry["staff_info"]:
            staff = info["staff"]
            lines, step = staff_geometry(staff)
            for g in entry["glyphs"]:
                if not (staff["top"] - 6 * step <= g["y"] <= staff["bottom"] + 6 * step):
                    continue
                if g["x"] < staff["x0"] + 8 * step:      # clef / key / time area
                    continue
                offset = (g["y"] - lines[0]) / step
                if abs(offset - round(offset)) <= GRID_TOLERANCE / step:
                    items.append((g["code"], g["x"], g["y"], step))
    counts = collections.Counter(c for c, _, _, _ in items)
    if not counts:
        return [], set(), None
    dominant = counts.most_common(1)[0][0]
    doms = [(x, y, st) for c, x, y, st in items if c == dominant]

    accidental_codes = set()
    for code, n in counts.items():
        if code == dominant or n < 3:
            continue
        insts = [(x, y, st) for c, x, y, st in items if c == code]
        right = sum(1 for x, y, st in insts
                    if any(abs(dy - y) <= 0.6 * st and 0.3 * st < dx - x < 3.5 * st
                           for dx, dy, _ in doms))
        if right / len(insts) > 0.6:
            accidental_codes.add(code)
    ordered = [c for c, _ in counts.most_common()
               if c not in accidental_codes and not (0x30 <= c <= 0x39)]
    return ordered, accidental_codes, dominant


def find_rest_codes(systems_all, notehead_codes, accidental_codes):
    """Rests sit at a fixed height; noteheads move with the pitch.

    That difference is the whole test.  A measure containing a rest can never
    be made to add up from its noteheads alone, so without this the bar check
    rejects every such measure and falls back to spacing.
    """
    positions = collections.defaultdict(set)
    totals = collections.Counter()
    for entry in systems_all:
        for info in entry["staff_info"]:
            staff = info["staff"]
            lines, step = staff_geometry(staff)
            for g in entry["glyphs"]:
                if g["code"] in notehead_codes or g["code"] in accidental_codes:
                    continue
                if 0x30 <= g["code"] <= 0x39:
                    continue
                if not (staff["top"] - 2 * step <= g["y"] <= staff["bottom"] + 2 * step):
                    continue
                if g["x"] < staff["x0"] + 8 * step:
                    continue
                positions[g["code"]].add(round(g["y"], 1))
                totals[g["code"]] += 1
    rests = set()
    for code, n in totals.items():
        if n >= 5 and len(positions[code]) / n < 0.5:
            rests.add(code)
    return rests


def build_measures(systems_all, notehead_codes, accidental_codes, rest_codes=()):
    measures = []
    for si, entry in enumerate(systems_all):
        for mx0, mx1 in entry["spans"]:
            m = {"page": entry["page"], "system": si, "index": len(measures),
                 "x0": mx0, "x1": mx1, "staves": []}
            for info in entry["staff_info"]:
                staff = info["staff"]
                lines, step = staff_geometry(staff)
                # inline accidentals, keyed by the pitch slot they modify
                inline = []
                for g in entry["glyphs"]:
                    if g["code"] in accidental_codes and mx0 - 1 <= g["x"] < mx1:
                        inline.append((g["x"], g["y"]))
                found = []
                for g in entry["glyphs"]:
                    if g["code"] not in notehead_codes:
                        continue
                    if not (mx0 - 1 <= g["x"] < mx1):
                        continue
                    if not (staff["top"] - 6 * step <= g["y"] <= staff["bottom"] + 6 * step):
                        continue
                    offset = (g["y"] - lines[0]) / step
                    if abs(offset - round(offset)) > GRID_TOLERANCE / step:
                        continue
                    idx = info["top_line"] - round(offset)
                    letter, octave = from_diatonic(idx)
                    alter = info["key"].get(letter, 0)
                    # an accidental just left of this notehead overrides the key
                    if any(abs(ay - g["y"]) <= 0.6 * step and 0.3 * step < g["x"] - ax < 3.5 * step
                           for ax, ay in inline):
                        alter = info.get("sig_alter", alter)
                    stem = stem_for(g["x"], g["y"], step, entry["verticals"])
                    found.append({"x": g["x"], "letter": letter, "octave": octave,
                                  "alter": alter, "code": g["code"],
                                  "beams": beam_count(stem, entry["beams"], step),
                                  "stemmed": stem is not None,
                                  "dotted": any(
                                      og["code"] not in notehead_codes
                                      and og["code"] not in accidental_codes
                                      and abs(og["y"] - g["y"]) <= 0.4 * step
                                      and 0.6 * step < og["x"] - g["x"] < 2.4 * step
                                      for og in entry["glyphs"])})
                found.sort(key=lambda n: (n["x"], -diatonic_index(n["letter"], n["octave"])))
                events = []
                for n in found:
                    if events and abs(n["x"] - events[-1]["x"]) <= CHORD_X_TOLERANCE:
                        events[-1]["notes"].append(n)
                    else:
                        events.append({"x": n["x"], "notes": [n]})
                # Rests occupy time but carry no pitch.
                for g in entry["glyphs"]:
                    if g["code"] not in rest_codes:
                        continue
                    if not (mx0 - 1 <= g["x"] < mx1):
                        continue
                    if not (staff["top"] - 2 * step <= g["y"] <= staff["bottom"] + 2 * step):
                        continue
                    events.append({"x": g["x"], "notes": [], "rest": g["code"]})
                events.sort(key=lambda e: e["x"])
                m["staves"].append({"clef": info["clef"], "key": info["key"],
                                    "events": events})
            measures.append(m)
    return measures


def extract(pdf_path, debug=False):
    """Extract notes, choosing which glyph codes are noteheads.

    Which private codepoint is a notehead cannot be looked up: MuseScore's
    fonts are not SMuFL, and the codes differ per engraver.  Three cheap tests
    were tried and only some of them work, which is worth recording:

    * **Adjacency** reliably finds accidentals - a sharp or flat sits
      immediately left of a notehead at the same pitch (84-85% of instances).
      This is used.
    * **Stem adjacency** does not separate noteheads from marks: articulations
      near stems also score 100%, while genuine half notes score as low as 39%.
    * **Scale fit** does not work either.  In a key with few accidentals most
      naturals are already in-scale, so junk glyphs score 100% too; it admitted
      ASCII parentheses as noteheads.  It is kept only as a *diagnostic*.

    What is left is a musical fact: standard notation has exactly three
    notehead shapes (black, half, whole).  So the candidates are capped at the
    three most frequent grid-aligned non-accidental codes, each of which must
    also take many different vertical positions - rests sit at fixed heights,
    noteheads move with the pitch.
    """
    systems_all, nums = read_document(pdf_path)
    ordered, accidental_codes, dominant = grid_candidates(systems_all)
    if not ordered:
        raise ValueError("No noteheads found on the staff grid.")

    # Pitch variety per candidate: distinct vertical positions over occurrences.
    positions = collections.defaultdict(set)
    totals = collections.Counter()
    for entry in systems_all:
        for info in entry["staff_info"]:
            staff = info["staff"]
            lines, step = staff_geometry(staff)
            for g in entry["glyphs"]:
                if not (staff["top"] - 6 * step <= g["y"] <= staff["bottom"] + 6 * step):
                    continue
                if g["x"] < staff["x0"] + 8 * step:
                    continue
                offset = (g["y"] - lines[0]) / step
                if abs(offset - round(offset)) <= GRID_TOLERANCE / step:
                    positions[g["code"]].add(round(g["y"], 1))
                    totals[g["code"]] += 1

    accepted, trace = [dominant], []
    for code in ordered:
        if code == dominant:
            continue
        n = totals[code]
        variety = len(positions[code]) / n if n else 0.0
        if len(accepted) >= 3:
            trace.append((code, n, variety, "rejected: only three notehead shapes exist"))
        elif n < 5:
            trace.append((code, n, variety, "rejected: too few"))
        elif variety < 0.5:
            trace.append((code, n, variety, "rejected: fixed height, reads as a rest"))
        else:
            accepted.append(code)
            trace.append((code, n, variety, "accepted as a notehead"))

    rest_codes = find_rest_codes(systems_all, set(accepted), accidental_codes)
    measures = build_measures(systems_all, set(accepted), accidental_codes, rest_codes)
    signature = None
    for entry in systems_all:
        for info in entry["staff_info"]:
            signature = signature or detect_time_signature(info["staff"], entry["glyphs"])
        if signature:
            break
    return {"pdf": pdf_path, "measures": measures, "systems": len(systems_all),
            "numbers": nums, "notehead_codes": accepted, "time_signature": signature,
            "rest_codes": sorted(rest_codes),
            "accidental_codes": sorted(accidental_codes),
            "trace": [(dominant, totals[dominant],
                       len(positions[dominant]) / max(1, totals[dominant]),
                       "seed: most frequent")] + trace}


NOTE_VALUES = (0.5, 1.0, 2.0, 3.0, 4.0)


def solve_notehead_values(measures, notehead_codes, beats_per_measure, tolerance=0.02):
    """Solve for what each notehead shape is worth, using the bar as the check.

    The font's codepoints are private, so a notehead's value cannot be looked
    up, and horizontal spacing turned out to be too blunt to rank them - in a
    waltz the median space around a half note is barely wider than around a
    quarter, and two shapes collapsed onto the same value.

    Notation is redundant instead: the durations in a measure must sum to the
    bar.  With only three notehead shapes there are a few dozen candidate
    assignments, so the right one can simply be searched for - the assignment
    that makes the most measures add up correctly is the one the engraver used.
    """
    # Pre-collect each staff-measure as a list of (code, beams, dotted).
    bars = []
    for m in measures:
        for st in m["staves"]:
            if st["events"]:
                bars.append([
                    (ev["notes"][0]["code"] if ev["notes"] else ev.get("rest"),
                     ev["notes"][0].get("beams", 0) if ev["notes"] else 0,
                     ev["notes"][0].get("dotted", False) if ev["notes"] else False)
                    for ev in st["events"]])
    if not bars:
        return {c: 1.0 for c in notehead_codes}, 0, 0

    codes = list(notehead_codes) + sorted(
        {c for bar in bars for c, _, _ in bar} - set(notehead_codes) - {None})
    best = None
    for combo in _combinations(codes, NOTE_VALUES):
        good = 0
        for bar in bars:
            total = 0.0
            for code, beams, dotted in bar:
                v = combo.get(code, 1.0) / (2 ** beams)
                if dotted:
                    v *= 1.5
                total += v
            if abs(total - beats_per_measure) <= tolerance * beats_per_measure:
                good += 1
        if best is None or good > best[0]:
            best = (good, dict(combo))
    return best[1], best[0], len(bars)


def _combinations(codes, values):
    if not codes:
        yield {}
        return
    head, rest = codes[0], codes[1:]
    for v in values:
        for tail in _combinations(rest, values):
            out = {head: v}
            out.update(tail)
            yield out


def glyph_durations(measure, staff_slot, ratios, unit, beats_per_measure):
    """Duration of each event from its notehead shape, beams and dots."""
    out = []
    for ev in staff_slot["events"]:
        if ev["notes"]:
            note = ev["notes"][0]
            value = ratios.get(note["code"], 1.0) / (2 ** note.get("beams", 0))
            if note.get("dotted"):
                value *= 1.5
        else:
            value = ratios.get(ev.get("rest"), 1.0)
        out.append(max(1e-6, value))
    return out


def assign_rhythm_from_glyphs(measures, beats_per_measure, ratios, unit, tolerance=0.02):
    """Use note values where they add up; fall back to spacing where they do not.

    A measure whose durations sum to the bar length is self-checking - the
    notation is redundant, and that redundancy is the test.  Where the sum is
    wrong (an unhandled tie, tuplet, rest or second voice) the spacing estimate
    is used for that measure instead, so a local failure stays local.
    """
    good = total = 0
    for m in measures:
        for st in m["staves"]:
            if not st["events"]:
                continue
            total += 1
            durations = glyph_durations(m, st, ratios, unit, beats_per_measure)
            if abs(sum(durations) - beats_per_measure) <= tolerance * beats_per_measure:
                good += 1
                cursor = 0.0
                for ev, d in zip(st["events"], durations):
                    ev["beat"], ev["duration"], ev["source"] = cursor, d, "glyph"
                    cursor += d
            else:
                st["_needs_spacing"] = True
    return good, total


def assign_rhythm(measures, beats_per_measure, grid=4):
    """Derive onsets and durations from the *gaps* between noteheads.

    Absolute x-position cannot be used directly: the first measure of a system
    carries a clef, key and time signature, which pushes its notes to the right
    and would make every onset late.  The gaps between consecutive noteheads
    carry the rhythm regardless of what precedes them, so durations are taken
    proportional to those gaps and normalised to fill the measure.

    Engraved spacing is monotonic in time but not linear - a half note gets less
    than twice a quarter's space - so the result is snapped to a `grid` of
    subdivisions per beat, which is what pulls "0.97 of a beat" back to exactly
    one.  Rhythm is the weakest part of this extractor; it degrades to slightly
    wrong note lengths rather than to a wrong number of notes.
    """
    for m in measures:
        for st in m["staves"]:
            evs = st["events"]
            if not evs or (st.get("events") and evs[0].get("source") == "glyph"):
                continue
            # Gap after each event; the last runs to the barline.
            gaps = []
            for i, ev in enumerate(evs):
                nxt = evs[i + 1]["x"] if i + 1 < len(evs) else m["x1"]
                gaps.append(max(1e-6, nxt - ev["x"]))
            total = sum(gaps)
            units = beats_per_measure * grid
            raw = [g / total * units for g in gaps]

            # Snap to the subdivision grid, keeping the measure's total intact.
            snapped = [max(1, int(round(r))) for r in raw]
            drift = int(units) - sum(snapped)
            while drift:                       # give or take from the longest
                i = snapped.index(max(snapped)) if drift < 0 else snapped.index(max(snapped))
                if drift < 0 and snapped[i] > 1:
                    snapped[i] -= 1
                    drift += 1
                elif drift > 0:
                    snapped[i] += 1
                    drift -= 1
                else:
                    break

            cursor = 0
            for ev, dur in zip(evs, snapped):
                ev["beat"] = cursor / grid
                ev["duration"] = dur / grid
                ev["source"] = "spacing"
                cursor += dur
    return measures


def key_fit(measures):
    """How well do the extracted pitches fit a single major/minor scale?

    A wrong clef or a mis-set reference line shifts every pitch on that staff,
    and the tell is that the pitch-class histogram stops looking like a scale.
    """
    hist = collections.Counter()
    for m in measures:
        for st in m["staves"]:
            for ev in st["events"]:
                for n in ev["notes"]:
                    semi = {"C":0,"D":2,"E":4,"F":5,"G":7,"A":9,"B":11}[n["letter"]]
                    hist[(semi + n["alter"]) % 12] += 1
    total = sum(hist.values()) or 1
    major = [0, 2, 4, 5, 7, 9, 11]
    best = None
    for tonic in range(12):
        inside = sum(hist[(tonic + d) % 12] for d in major)
        score = inside / total
        if best is None or score > best[1]:
            best = (tonic, score)
    names = ["C","C#","D","Eb","E","F","F#","G","Ab","A","Bb","B"]
    return names[best[0]], best[1], hist, total


def to_musicxml(result, beats, beat_type, chords=None):
    root = ET.Element("score-partwise", version="3.1")
    plist = ET.SubElement(root, "part-list")
    sp = ET.SubElement(plist, "score-part", id="P1")
    ET.SubElement(sp, "part-name").text = "Accordion"
    part = ET.SubElement(root, "part", id="P1")
    divisions = 8

    for i, m in enumerate(result["measures"]):
        me = ET.SubElement(part, "measure", number=str(i + 1))
        if i == 0:
            attrs = ET.SubElement(me, "attributes")
            ET.SubElement(attrs, "divisions").text = str(divisions)
            key = ET.SubElement(attrs, "key")
            first_key = next((st["key"] for st in m["staves"] if st["key"]), {})
            fifths = sum(1 for v in first_key.values() if v > 0) or \
                -sum(1 for v in first_key.values() if v < 0)
            ET.SubElement(key, "fifths").text = str(fifths)
            time = ET.SubElement(attrs, "time")
            ET.SubElement(time, "beats").text = str(beats)
            ET.SubElement(time, "beat-type").text = str(beat_type)
            clef = ET.SubElement(attrs, "clef")
            ET.SubElement(clef, "sign").text = m["staves"][0]["clef"] or "G"
            ET.SubElement(clef, "line").text = "2" if (m["staves"][0]["clef"] or "G") == "G" else "4"
        if chords and i < len(chords) and chords[i]:
            for symbol in chords[i][:1]:
                harm = ET.SubElement(me, "harmony")
                rootel = ET.SubElement(harm, "root")
                ET.SubElement(rootel, "root-step").text = symbol[0]
                rest = symbol[1:]
                if rest[:1] in ("#", "b"):
                    ET.SubElement(rootel, "root-alter").text = "1" if rest[0] == "#" else "-1"
                    rest = rest[1:]
                kind = ("minor" if rest.startswith("m") and not rest.startswith("maj")
                        else "dominant" if "7" in rest else "major")
                ET.SubElement(harm, "kind", text=symbol).text = kind

        events = m["staves"][0]["events"] if m["staves"] else []
        if not events:
            note = ET.SubElement(me, "note")
            ET.SubElement(note, "rest")
            ET.SubElement(note, "duration").text = str(divisions * beats)
            ET.SubElement(note, "type").text = "whole"
            continue
        for ev in events:
            if not ev["notes"]:
                note = ET.SubElement(me, "note")
                ET.SubElement(note, "rest")
                ET.SubElement(note, "duration").text = str(
                    max(1, int(round(ev["duration"] * divisions))))
                continue
            for k, n in enumerate(ev["notes"]):
                note = ET.SubElement(me, "note")
                if k:
                    ET.SubElement(note, "chord")
                pitch = ET.SubElement(note, "pitch")
                ET.SubElement(pitch, "step").text = n["letter"]
                if n["alter"]:
                    ET.SubElement(pitch, "alter").text = str(n["alter"])
                ET.SubElement(pitch, "octave").text = str(n["octave"])
                ET.SubElement(note, "duration").text = str(
                    max(1, int(round(ev["duration"] * divisions))))
    # OpenSheetMusicDisplay rejects a MusicXML string that carries no XML
    # declaration ("the document which was provided is invalid"), even though
    # DOMParser accepts it happily, so emit a whole document, not a bare element.
    declaration = '<?xml version="1.0" encoding="UTF-8" standalone="no"?>'
    doctype = ('<!DOCTYPE score-partwise PUBLIC '
               '"-//Recordare//DTD MusicXML 3.1 Partwise//EN" '
               '"http://www.musicxml.org/dtds/partwise.dtd">')
    newline = chr(10)
    return (declaration + newline + doctype + newline
            + ET.tostring(root, encoding="unicode"))


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("pdf")
    ap.add_argument("--beats", type=int, default=None, help="beats per measure")
    ap.add_argument("--beat-type", type=int, default=None)
    ap.add_argument("--musicxml", help="write MusicXML to this path")
    ap.add_argument("--check", action="store_true", help="print key-fit diagnostics")
    ap.add_argument("--limit", type=int, default=8, help="measures to print")
    ap.add_argument("--with-chords", action="store_true",
                    help="also read chord symbols and emit them as <harmony>")
    ap.add_argument("--json", action="store_true",
                    help="emit machine-readable stats instead of a report")
    args = ap.parse_args()

    try:
        result = extract(args.pdf)
    except ValueError as exc:
        if args.json:
            sys.stdout.write(json.dumps({"error": str(exc), "scanned": True}) + "\n")
            raise SystemExit(1)
        sys.stderr.write("%s\n" % exc)
        raise SystemExit(1)
    signature = result.get("time_signature")
    beats = args.beats or (signature[0] if signature else 4)
    beat_type = args.beat_type or (signature[1] if signature else 4)

    # Note values first; spacing only where the values do not add up.
    values, solved, bars = solve_notehead_values(
        result["measures"], result["notehead_codes"], beats)
    good, total = assign_rhythm_from_glyphs(result["measures"], beats, values, 1.0)
    assign_rhythm(result["measures"], beats)
    result["bar_fit"] = (good, total, values)

    total_notes = sum(len(ev["notes"]) for m in result["measures"]
                      for st in m["staves"] for ev in st["events"])
    tonic0, key_score, _, key_total = key_fit(result["measures"])
    good0, total0, values0 = result["bar_fit"]

    if args.json:
        chords_merged = 0
        if args.with_chords:
            from extract_chords import extract as extract_chord_symbols
            chord_result = extract_chord_symbols(args.pdf)
            chords_merged = chord_result["chords_found"]
            if args.musicxml and len(chord_result["measure_chords"]) == len(result["measures"]):
                open(args.musicxml, "w", encoding="utf-8").write(
                    to_musicxml(result, beats, beat_type, chord_result["measure_chords"]))
            elif args.musicxml:
                open(args.musicxml, "w", encoding="utf-8").write(
                    to_musicxml(result, beats, beat_type))
        elif args.musicxml:
            open(args.musicxml, "w", encoding="utf-8").write(
                to_musicxml(result, beats, beat_type))
        sys.stdout.write(json.dumps({
            "pdf": args.pdf,
            "systems": result["systems"],
            "measures": len(result["measures"]),
            "noteheads": total_notes,
            "key": tonic0,
            "key_fit": round(key_score, 4),
            "bars_ok": good0,
            "bars_total": total0,
            "bar_fit": round(good0 / max(1, total0), 4),
            "time_signature": [beats, beat_type],
            "time_signature_engraved": bool(signature),
            "chords_merged": chords_merged,
            "musicxml": args.musicxml,
        }) + "\n")
        return

    print("%s" % args.pdf)
    print("  systems       : %d" % result["systems"])
    print("  measures      : %d" % len(result["measures"]))
    print("  noteheads     : %d" % total_notes)
    tonic, score, hist, tot = key_fit(result["measures"])
    print("  key fit       : %.1f%% of %d notes fit a %s scale" % (score * 100, tot, tonic))
    print("  notehead codes: %s" % ", ".join("U+%04X" % c for c in result["notehead_codes"]))
    print("  accidentals   : %s" % (", ".join("U+%04X" % c for c in result["accidental_codes"]) or "none"))
    print("  rests         : %s" % (", ".join("U+%04X" % c for c in result["rest_codes"]) or "none"))
    print("  time signature: %s" % ("%d/%d (engraved)" % signature if signature
                                    else "%d/%d (assumed)" % (beats, beat_type)))
    good, total, values = result["bar_fit"]
    print("  note values   : %d/%d staff-measures add up to the bar (%.0f%%); "
          "the rest fall back to spacing" % (good, total, 100.0 * good / max(1, total)))
    print("  shape values  : %s" % ", ".join(
        "U+%04X=%g beat%s" % (c, v, "" if v == 1 else "s")
        for c, v in sorted(values.items(), key=lambda kv: -kv[1])))
    if args.check:
        for code, n, variety, note in result["trace"]:
            print("     U+%04X  n=%-4d variety=%.2f  %s" % (code, n, variety, note))

    for m in result["measures"][:args.limit]:
        for si, st in enumerate(m["staves"]):
            if not st["events"]:
                continue
            desc = "  ".join(
                "%.2f:%s" % (ev["beat"], "+".join(
                    n["letter"] + ("#" if n["alter"] > 0 else "b" if n["alter"] < 0 else "")
                    + str(n["octave"]) for n in ev["notes"]) if ev["notes"] else "rest")
                for ev in st["events"])
            print("   m%-3d %s: %s" % (m["index"] + 1, st["clef"] or "?", desc))

    chords = None
    if args.with_chords:
        from extract_chords import extract as extract_chord_symbols
        chord_result = extract_chord_symbols(args.pdf)
        chords = chord_result["measure_chords"]
        if len(chords) != len(result["measures"]):
            print("  warning       : %d chord measures vs %d note measures"
                  % (len(chords), len(result["measures"])))
        else:
            print("  chords        : %d symbols merged in" % chord_result["chords_found"])

    if args.musicxml:
        xml = to_musicxml(result, beats, beat_type, chords)
        open(args.musicxml, "w", encoding="utf-8").write(xml)
        print("\n  wrote %s" % args.musicxml)


if __name__ == "__main__":
    main()
