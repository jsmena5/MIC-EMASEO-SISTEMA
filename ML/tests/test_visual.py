from ultralytics import RTDETR

# 1. Cargar tu modelo usando la RUTA EXACTA de donde se guardó (usamos la 'r' para proteger las barras en Windows)
ruta_modelo = r"C:\REPOSITORIOS GITHUB\MIC-EMASEO-SISTEMA\runs\detect\runs\train\rtdetr_l_garbage_v3\weights\best.pt"
model = RTDETR(ruta_modelo)

# 2. La ruta de tu foto
ruta_imagen = r"C:\Users\Bryan\Downloads\Basura.png"

# 3. Hacer la predicción y guardar el resultado
results = model.predict(source=ruta_imagen, conf=0.18, save=True)
print("--------------------------------------------------")
print("¡Predicción terminada!")
print("Busca tu foto con las cajas dibujadas dentro de la carpeta: runs/detect/predict")
print("--------------------------------------------------")