"""
Entrenamiento EfficientDet-D2 para comparación de modelos EMASEO
Hardware objetivo: RTX 3050 6GB VRAM, 32GB RAM

Prerrequisitos:
    1. Convertir dataset: python yolo_to_coco.py
    2. Activar venv:      .\\venv_emaseo\\Scripts\\Activate.ps1
    3. Correr:            python train_efficientdet.py
"""
import time
import torch
import numpy as np
from collections import defaultdict
from pathlib import Path
from torch.utils.data import DataLoader
from PIL import Image
from pycocotools.coco import COCO
from pycocotools.cocoeval import COCOeval

# ── Configuración ──────────────────────────────────────────────────────────────
DATA_DIR    = "dataset"
COCO_DIR    = f"{DATA_DIR}/coco"
EPOCHS      = 100
BATCH       = 4
LR          = 1e-4
IMGSZ       = 640
AMP         = True
NAME        = "efficientdet_d2_garbage"
SAVE_DIR    = f"modelos/{NAME}.pt"
RESULTS_CSV = "resultados/efficientdet_d2_results.csv"
# ──────────────────────────────────────────────────────────────────────────────


class GarbageDataset(torch.utils.data.Dataset):
    def __init__(self, img_dir, ann_json, imgsz=640):
        self.img_dir = Path(img_dir)
        self.imgsz   = imgsz
        self.coco    = COCO(ann_json)
        self.ids     = list(self.coco.imgs.keys())

    def __len__(self):
        return len(self.ids)

    def __getitem__(self, idx):
        img_id = self.ids[idx]
        info   = self.coco.imgs[img_id]
        img    = Image.open(self.img_dir / info["file_name"]).convert("RGB")
        orig_w, orig_h = img.size
        img    = img.resize((self.imgsz, self.imgsz))
        tensor = torch.from_numpy(np.array(img)).permute(2, 0, 1).float() / 255.0

        anns    = self.coco.loadAnns(self.coco.getAnnIds(imgIds=img_id))
        boxes, labels = [], []
        for ann in anns:
            x, y, w, h = ann["bbox"]
            x1, y1 = x / orig_w, y / orig_h
            x2, y2 = (x + w) / orig_w, (y + h) / orig_h
            boxes.append([x1, y1, x2, y2])
            labels.append(ann["category_id"])

        target = {
            "boxes":    torch.tensor(boxes,  dtype=torch.float32) if boxes else torch.zeros((0, 4)),
            "labels":   torch.tensor(labels, dtype=torch.long)    if labels else torch.zeros(0, dtype=torch.long),
            "image_id": torch.tensor([img_id]),
        }
        return tensor, target


def collate_fn(batch):
    return list(zip(*batch))


def prep_targets(targets, labeler, device, imgsz):
    """Convierte raw targets en anchor assignments que DetBenchTrain espera."""
    batch_cls = defaultdict(list)
    batch_box = defaultdict(list)
    num_pos   = []

    for t in targets:
        boxes  = t["boxes"]
        labels = t["labels"]

        if len(boxes) == 0:
            boxes  = torch.zeros((1, 4))
            labels = torch.zeros(1, dtype=torch.long)

        # effdet espera [y1, x1, y2, x2] en píxeles absolutos
        b = boxes.clone()
        b_pix = torch.stack(
            [b[:, 1] * imgsz, b[:, 0] * imgsz,
             b[:, 3] * imgsz, b[:, 2] * imgsz], dim=1
        )

        cls_t, box_t, num_p = labeler.label_anchors(b_pix, labels.float())

        for level, (c, bx) in enumerate(zip(cls_t, box_t)):
            batch_cls[level].append(c)
            batch_box[level].append(bx)
        num_pos.append(num_p)

    target_dict = {
        "label_num_positives": torch.tensor(num_pos, dtype=torch.float32).to(device)
    }
    for level in sorted(batch_cls.keys()):
        target_dict[f"label_cls_{level}"]  = torch.stack(batch_cls[level]).to(device)
        target_dict[f"label_bbox_{level}"] = torch.stack(batch_box[level]).to(device)

    return target_dict


def train_one_epoch(model, loader, optimizer, scaler, labeler, device):
    model.train()
    total_loss = 0.0
    for imgs, targets in loader:
        imgs   = torch.stack(imgs).to(device)
        t_dict = prep_targets(targets, labeler, device, IMGSZ)

        optimizer.zero_grad()
        with torch.amp.autocast("cuda", enabled=AMP):
            output = model(imgs, t_dict)
            loss   = output["loss"]

        scaler.scale(loss).backward()
        scaler.step(optimizer)
        scaler.update()
        total_loss += loss.item()

    return total_loss / len(loader)


def evaluate(model, loader, ann_json, device):
    """Calcula mAP@50 con pycocotools."""
    from effdet import create_model as _cm
    bench = _cm("efficientdet_d2", bench_task="predict",
                num_classes=1, pretrained=False,
                image_size=(IMGSZ, IMGSZ))
    bench.model.load_state_dict(model.model.state_dict())
    bench = bench.to(device).eval()

    coco_gt = COCO(ann_json)
    results = []

    with torch.no_grad():
        for imgs, targets in loader:
            imgs  = torch.stack(imgs).to(device)
            n = imgs.shape[0]
            img_info = {
                "img_scale": torch.ones(n, device=device),
                "img_size":  torch.tensor([[IMGSZ, IMGSZ]] * n, dtype=torch.float32, device=device),
            }
            with torch.amp.autocast("cuda", enabled=AMP):
                preds = bench(imgs, img_info)
            for pred, target in zip(preds, targets):
                img_id = int(target["image_id"])
                if pred is None or len(pred) == 0:
                    continue
                for det in pred:
                    x1, y1, x2, y2, score, _ = det.tolist()
                    if score < 0.01:
                        continue
                    results.append({
                        "image_id":   img_id,
                        "category_id": 1,
                        "bbox":  [x1, y1, x2 - x1, y2 - y1],
                        "score": float(score),
                    })

    if not results:
        return 0.0, 0.0

    coco_dt = coco_gt.loadRes(results)
    ev = COCOeval(coco_gt, coco_dt, "bbox")
    ev.evaluate(); ev.accumulate(); ev.summarize()
    return ev.stats[1], ev.stats[0]   # mAP@50, mAP@50:95


def main():
    from effdet import create_model, get_efficientdet_config
    from effdet.anchors import Anchors, AnchorLabeler

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Dispositivo: {device}")
    if device.type == "cuda":
        vram = torch.cuda.get_device_properties(0).total_memory / 1e9
        print(f"GPU: {torch.cuda.get_device_name(0)} ({vram:.1f} GB)")

    # Dataset y loaders
    train_ds = GarbageDataset(f"{DATA_DIR}/train/images", f"{COCO_DIR}/train.json", IMGSZ)
    val_ds   = GarbageDataset(f"{DATA_DIR}/valid/images", f"{COCO_DIR}/valid.json",  IMGSZ)
    train_loader = DataLoader(train_ds, batch_size=BATCH, shuffle=True,  collate_fn=collate_fn, num_workers=0)
    val_loader   = DataLoader(val_ds,   batch_size=BATCH, shuffle=False, collate_fn=collate_fn, num_workers=0)

    # Modelo y anchor labeler
    config  = get_efficientdet_config("efficientdet_d2")
    config.num_classes  = 1
    config.image_size   = [IMGSZ, IMGSZ]
    anchors = Anchors.from_config(config)
    labeler = AnchorLabeler(anchors, num_classes=1, match_threshold=0.5)

    model = create_model("efficientdet_d2", bench_task="train",
                         num_classes=1, pretrained=True,
                         image_size=(IMGSZ, IMGSZ)).to(device)

    optimizer = torch.optim.AdamW(model.parameters(), lr=LR, weight_decay=0.01)
    scaler    = torch.amp.GradScaler("cuda")

    Path("modelos").mkdir(exist_ok=True)
    Path("resultados").mkdir(exist_ok=True)

    # Reanudar desde checkpoint si existe
    start_epoch = 1
    best_map50  = 0.0
    log_rows    = ["epoch,train_loss,mAP50,mAP50_95,tiempo_s"]
    ckpt_path   = Path(f"modelos/{NAME}_last.pt")

    if ckpt_path.exists():
        ckpt = torch.load(ckpt_path, map_location=device)
        model.load_state_dict(ckpt["model"])
        optimizer.load_state_dict(ckpt["optimizer"])
        start_epoch = ckpt["epoch"] + 1
        best_map50  = ckpt.get("best_map50", 0.0)
        log_rows    = ckpt.get("log_rows", log_rows)
        print(f"Reanudando desde epoch {start_epoch} (mejor mAP50={best_map50:.4f})")

    print(f"\n{'='*55}")
    print(f"EfficientDet-D2 | epochs={EPOCHS} | batch={BATCH} | imgsz={IMGSZ}")
    print(f"{'='*55}\n")

    for epoch in range(start_epoch, EPOCHS + 1):
        t0   = time.time()
        loss = train_one_epoch(model, train_loader, optimizer, scaler, labeler, device)

        # Evaluar cada 5 epochs para ahorrar tiempo
        if epoch % 5 == 0 or epoch == EPOCHS:
            map50, map5095 = evaluate(model, val_loader, f"{COCO_DIR}/valid.json", device)
        else:
            map50, map5095 = 0.0, 0.0

        elapsed = round(time.time() - t0, 1)
        print(f"Epoch {epoch:3d}/{EPOCHS}  loss={loss:.4f}  mAP50={map50:.4f}  mAP50:95={map5095:.4f}  ({elapsed}s)")
        log_rows.append(f"{epoch},{loss:.4f},{map50:.4f},{map5095:.4f},{elapsed}")

        # Guardar checkpoint cada epoch (permite reanudar si se cae)
        torch.save({
            "epoch": epoch, "model": model.state_dict(),
            "optimizer": optimizer.state_dict(),
            "best_map50": best_map50, "log_rows": log_rows,
        }, ckpt_path)

        if map50 > best_map50:
            best_map50 = map50
            torch.save(model.state_dict(), SAVE_DIR)
            print(f"  -> Guardado mejor modelo (mAP50={best_map50:.4f})")

    with open(RESULTS_CSV, "w") as f:
        f.write("\n".join(log_rows))

    print(f"\nResultados: {RESULTS_CSV}")
    print(f"Pesos:      {SAVE_DIR}")


if __name__ == "__main__":
    main()
