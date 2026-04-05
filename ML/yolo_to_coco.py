"""
Convierte el dataset de formato YOLO (.txt) a formato COCO (.json)
para poder entrenar EfficientDet-D2.

Uso:
    python yolo_to_coco.py
"""
import os
import json
from pathlib import Path
from PIL import Image


def yolo_to_coco(split, img_dir, lbl_dir, out_json):
    images, annotations, ann_id = [], [], 1
    img_paths = sorted(Path(img_dir).glob("*.jpg"))

    for img_id, img_path in enumerate(img_paths, 1):
        w, h = Image.open(img_path).size

        images.append({
            "id": img_id,
            "file_name": img_path.name,
            "width": w,
            "height": h 
        })

        lbl = Path(lbl_dir) / (img_path.stem + ".txt")
        if lbl.exists():
            for line in lbl.read_text().strip().splitlines():
                parts = line.split()
                if len(parts) != 5:
                    continue
                _, cx, cy, bw, bh = map(float, parts)
                x = (cx - bw / 2) * w
                y = (cy - bh / 2) * h
                abs_w = bw * w
                abs_h = bh * h
                annotations.append({
                    "id": ann_id,
                    "image_id": img_id,
                    "category_id": 1,
                    "bbox": [round(x, 2), round(y, 2), round(abs_w, 2), round(abs_h, 2)],
                    "area": round(abs_w * abs_h, 2),
                    "iscrowd": 0
                })
                ann_id += 1

    coco = {
        "images": images,
        "annotations": annotations,
        "categories": [{"id": 1, "name": "garbage", "supercategory": "object"}]
    }

    with open(out_json, "w") as f:
        json.dump(coco, f)

    print(f"[{split:5s}] {len(images):4d} imágenes, {len(annotations):4d} anotaciones → {out_json}")


if __name__ == "__main__":
    base = "dataset"
    out_dir = f"{base}/coco"
    os.makedirs(out_dir, exist_ok=True)

    splits = [
        ("train", f"{base}/train/images",  f"{base}/train/labels"),
        ("valid", f"{base}/valid/images",  f"{base}/valid/labels"),
        ("test",  f"{base}/test/images",   f"{base}/test/labels"),
    ]

    for split, img_dir, lbl_dir in splits:
        yolo_to_coco(split, img_dir, lbl_dir, f"{out_dir}/{split}.json")

    print("\nConversión completada. JSONs guardados en dataset/coco/")
