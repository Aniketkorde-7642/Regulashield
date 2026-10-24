from __future__ import annotations

from pathlib import Path

import fitz


OUTPUT_DIR = Path(__file__).resolve().parent / "generated"
SAMPLES = {
    "good_affiliation.pdf": (
        "Institution Name: North Valley College\n"
        "Affiliation Number: AICTE-2026-001\n"
        "Academic Year: 2026-27\n"
    ),
    "good_faculty.pdf": (
        "Institution Name: North Valley College\n"
        "Faculty Count: 42\n"
        "Student Count: 860\n"
        "Academic Year: 2026-27\n"
    ),
    "mismatch_faculty.pdf": (
        "Institution Name: North Valley College\n"
        "Faculty Count: 27\n"
        "Academic Year: 2026-27\n"
    ),
    "revoked_affiliation.pdf": (
        "Institution Name: North Valley College\n"
        "Affiliation Number: AICTE-FAKE-001\n"
        "Academic Year: 2026-27\n"
    ),
}


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    for filename, text in SAMPLES.items():
        pdf = fitz.open()
        page = pdf.new_page()
        page.insert_text((60, 70), "SYNTHETIC DEMONSTRATION DOCUMENT", fontsize=14)
        page.insert_textbox(fitz.Rect(60, 105, 540, 300), text, fontsize=11, lineheight=1.6)
        pdf.save(OUTPUT_DIR / filename)
        pdf.close()
    print(f"Generated {len(SAMPLES)} sample PDFs in {OUTPUT_DIR}")


if __name__ == "__main__":
    main()
