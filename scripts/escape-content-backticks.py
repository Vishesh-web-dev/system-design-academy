#!/usr/bin/env python3
"""Escape stray backticks inside lesson template literals.

Lesson prose is written in TypeScript template literals, so an unescaped
backtick — from an inline code span or a fenced block — silently terminates
the literal and produces a wall of parse errors. `tsc` catches it, but the
error points at the wrong place, so this normalises the escaping instead.

Usage: python3 scripts/escape-content-backticks.py content/lessons/**/*.ts
"""
import pathlib, re, sys
OPEN = re.compile(r'^(\s*(?:body|answer|discussion|prompt|modelAnswer|code|intro):\s*)`(.*)$')
for path in sys.argv[1:]:
    p = pathlib.Path(path)
    lines = p.read_text().split('\n')
    out, inside, fixed = [], False, 0
    for line in lines:
        if not inside:
            m = OPEN.match(line)
            if m:
                inside = True
                head, rest = m.group(1), m.group(2)
                if rest.endswith('`,') and not rest.endswith('\\`,'):
                    out.append(head + '`' + re.sub(r'(?<!\\)`', r'\\`', rest[:-2]) + '`,'); inside = False
                else:
                    out.append(head + '`' + re.sub(r'(?<!\\)`', r'\\`', rest))
                continue
            out.append(line)
        else:
            if line.endswith('`,') and not line.endswith('\\`,'):
                body = re.sub(r'(?<!\\)`', r'\\`', line[:-2])
                if body != line[:-2]: fixed += 1
                out.append(body + '`,'); inside = False
            else:
                body = re.sub(r'(?<!\\)`', r'\\`', line)
                if body != line: fixed += 1
                out.append(body)
    if inside:
        print(f'{path}: UNTERMINATED — skipped'); continue
    p.write_text('\n'.join(out))
    print(f'{path}: {fixed} line(s) escaped')
