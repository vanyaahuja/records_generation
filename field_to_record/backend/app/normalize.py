"""Pure normalization. Evidence always refers to the original text."""

import re

ONES = dict(
    zip(
        "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split(),
        range(20),
    )
)
ONES.update({"oh": 0})
TENS = dict(
    zip(
        "twenty thirty forty fifty sixty seventy eighty ninety".split(),
        range(20, 100, 10),
    )
)
NUMBER_WORDS = set(ONES) | set(TENS) | {"hundred", "thousand", "point", "and"}
PART = "|".join(sorted(NUMBER_WORDS, key=len, reverse=True))
NUM = r"(?:\d+(?:\.\d+)?|(?:" + PART + r")(?:[ -]+(?:" + PART + r"))*)"


def number(raw):
    raw = raw.lower().strip().replace("-", " ")
    try:
        return float(raw)
    except ValueError:
        pass
    if " point " in raw:
        whole, decimal = raw.split(" point ", 1)
        digits = "".join(
            str(ONES[w]) for w in decimal.split() if w in ONES and ONES[w] < 10
        )
        if not digits:
            raise ValueError("Invalid decimal")
        return number(whole) + float("0." + digits)
    words = [w for w in raw.split() if w != "and"]
    if (
        len(words) >= 2
        and words[0] in ONES
        and words[1] in TENS
        and ONES[words[0]] < 10
    ):
        return (
            ONES[words[0]] * 100
            + TENS[words[1]]
            + sum(ONES.get(w, 0) for w in words[2:])
        )
    total = current = 0
    for w in words:
        if w in ONES:
            current += ONES[w]
        elif w in TENS:
            current += TENS[w]
        elif w == "hundred":
            current = (current or 1) * 100
        elif w == "thousand":
            total += (current or 1) * 1000
            current = 0
        else:
            raise ValueError("Not a number")
    return float(total + current)


UNIT_ALIASES = {
    "milligram": "mg",
    "milligrams": "mg",
    "microgram": "mcg",
    "micrograms": "mcg",
    "mics": "mcg",
    "gram": "g",
    "grams": "g",
    "milliliter": "mL",
    "milliliters": "mL",
    "millilitre": "mL",
    "millilitres": "mL",
    "ml": "mL",
    "units": "unit",
}


def normalize_with_offsets(text):
    output, offsets = [], []
    for token in re.finditer(r"\w+|[^\w\s]|\s+", text):
        raw = token.group()
        value = UNIT_ALIASES.get(raw.lower(), raw.lower())
        output.append(value)
        offsets.extend([(token.start(), token.end())] * len(value))
    return "".join(output), offsets
