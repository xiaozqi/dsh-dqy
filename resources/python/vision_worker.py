import json
import sys

import cv2
import numpy as np

_ocr_engine = None


def get_ocr():
    global _ocr_engine
    if _ocr_engine is None:
        from rapidocr_onnxruntime import RapidOCR

        _ocr_engine = RapidOCR()
    return _ocr_engine


def load_image(path):
    data = np.fromfile(path, dtype=np.uint8)
    img = cv2.imdecode(data, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError(f"cannot read image: {path}")
    return img


def do_ocr(image_path):
    engine = get_ocr()
    result, _ = engine(image_path)
    blocks = []
    if not result:
        return blocks
    for box, text, score in result:
        xs = [p[0] for p in box]
        ys = [p[1] for p in box]
        left, top = int(min(xs)), int(min(ys))
        right, bottom = int(max(xs)), int(max(ys))
        blocks.append(
            {
                "text": text,
                "confidence": float(score),
                "bounds": [left, top, right, bottom],
                "center": [int((left + right) / 2), int((top + bottom) / 2)],
            }
        )
    return blocks


def match_one(haystack, template_path, threshold):
    needle = load_image(template_path)
    if needle.shape[0] > haystack.shape[0] or needle.shape[1] > haystack.shape[1]:
        return None
    result = cv2.matchTemplate(haystack, needle, cv2.TM_CCOEFF_NORMED)
    _, max_val, _, max_loc = cv2.minMaxLoc(result)
    if max_val < threshold:
        return None
    height, width = needle.shape[:2]
    return {
        "score": float(max_val),
        "point": [
            int(max_loc[0] + width / 2),
            int(max_loc[1] + height / 2),
        ],
    }


def do_find_template(image_path, template_path, threshold):
    screen = load_image(image_path)
    hit = match_one(screen, template_path, threshold)
    return hit["point"] if hit else None


def do_match_templates(image_path, templates, threshold):
    screen = load_image(image_path)
    out = []
    for template in templates:
        hit = match_one(screen, template["path"], threshold)
        if hit:
            out.append(
                {
                    "label": template["label"],
                    "template": template["path"],
                    "point": hit["point"],
                    "score": hit["score"],
                }
            )
    return out


def do_locate_text(image_path, text):
    for block in do_ocr(image_path):
        if text in block["text"]:
            return block["center"]
    return None


def main():
    cmd = json.loads(sys.argv[1])
    mode = cmd["mode"]
    if mode == "ocr":
        data = do_ocr(cmd["image"])
    elif mode == "find_template":
        data = do_find_template(
            cmd["image"], cmd["template"], float(cmd.get("threshold", 0.8))
        )
    elif mode == "match_templates":
        data = do_match_templates(
            cmd["image"], cmd["templates"], float(cmd.get("threshold", 0.8))
        )
    elif mode == "locate_text":
        data = do_locate_text(cmd["image"], cmd["text"])
    else:
        raise ValueError(f"unknown mode: {mode}")
    print(json.dumps({"ok": True, "data": data}, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        sys.exit(1)
