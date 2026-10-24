from __future__ import annotations

import fitz

from app.services.validation import extract_pdf_document


def make_image_only_pdf() -> bytes:
    source = fitz.open()
    source_page = source.new_page()
    source_page.insert_text(
        (72, 120),
        "RegulaShield OCR runtime check",
        fontsize=28,
    )
    image = source_page.get_pixmap(matrix=fitz.Matrix(3, 3)).tobytes("png")
    source.close()

    scanned = fitz.open()
    scanned_page = scanned.new_page()
    scanned_page.insert_image(scanned_page.rect, stream=image)
    pdf_bytes = scanned.tobytes()
    scanned.close()
    return pdf_bytes


def main() -> None:
    result = extract_pdf_document(make_image_only_pdf())
    expected_text = "RegulaShield OCR runtime check"
    if (
        result.scanned_pages != 1
        or result.ocr_used_pages != 1
        or expected_text.casefold() not in result.raw_text.casefold()
    ):
        raise RuntimeError(
            "Tesseract OCR smoke test failed: "
            f"scanned_pages={result.scanned_pages}, "
            f"ocr_used_pages={result.ocr_used_pages}, "
            f"raw_text={result.raw_text!r}"
        )
    print("Tesseract image-only PDF OCR smoke test passed.")


if __name__ == "__main__":
    main()
