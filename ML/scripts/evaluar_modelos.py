"""Evalúa los 3 modelos en el test set y guarda resultados en JSON."""
import json
from ultralytics import YOLO, RTDETR

DATA = "dataset/data.yaml"

def main():
    resultados = {}

    for nombre, cls, ruta in [
        ("yolov8n",   YOLO,   "modelos/yolov8n_best.pt"),
        ("yolo11m",   YOLO,   "modelos/yolo11m_best.pt"),
        ("rtdetr_l",  RTDETR, "modelos/rtdetr_l_best.pt"),
    ]:
        print(f"\n{'='*40}\n{nombre}\n{'='*40}")
        model = cls(ruta)
        v = model.val(data=DATA, split="test", verbose=False, workers=0)
        resultados[nombre] = {
            "mAP50":     round(float(v.box.map50), 4),
            "mAP50_95":  round(float(v.box.map),   4),
            "precision": round(float(v.box.mp),     4),
            "recall":    round(float(v.box.mr),     4),
        }
        print(json.dumps(resultados[nombre], indent=2))

    with open("resultados/metricas_test_real.json", "w") as f:
        json.dump(resultados, f, indent=2)

    print("\n\nRESULTADOS FINALES:")
    print(json.dumps(resultados, indent=2))
    print("\nGuardado en resultados/metricas_test_real.json")

if __name__ == "__main__":
    main()
