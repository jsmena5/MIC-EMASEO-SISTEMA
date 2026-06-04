"""Test individual inference steps on VPS to find the 300s hang."""
import paramiko, sys

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect("95.111.234.82", username="root", password="familiat", timeout=15)

TEST_CODE = r"""
import time, os, sys
os.environ['HUGGINGFACE_HUB_OFFLINE'] = '1'
os.environ['HF_HOME'] = '/app/hf_cache'

print('=== Step-by-step inference test ===', flush=True)

# 1. Load model
t = time.time()
from ultralytics import RTDETR
model = RTDETR('/app/models/rtdetr_l_best.pt')
print(f'1. Model loaded: {time.time()-t:.2f}s', flush=True)

# 2. Load test image
import glob
images = glob.glob('/app/uploads/*.jpg')
if not images:
    print('ERROR: no images in uploads', flush=True)
    sys.exit(1)
img_path = images[0]
from PIL import Image
img = Image.open(img_path).convert('RGB')
print(f'2. Image opened: {img.size} ({img_path[-20:]})', flush=True)

# 3. RT-DETR inference
t = time.time()
results = model.predict(img, conf=0.60, iou=0.50, verbose=False)
print(f'3. RTDETR inference: {time.time()-t:.2f}s  detections={len(results[0].boxes) if results else 0}', flush=True)

# 4. Check if detections exist
if results and len(results[0].boxes) > 0:
    print(f'   Found {len(results[0].boxes)} detections -> will run CLIP gate', flush=True)

    # 5. Load CLIP
    t = time.time()
    from semantic_gate import verify_is_garbage, warm_up_clip
    print(f'4. semantic_gate imported: {time.time()-t:.2f}s', flush=True)

    t = time.time()
    warm_up_clip()
    print(f'5. CLIP warmed up: {time.time()-t:.2f}s', flush=True)

    # 6. CLIP inference
    t = time.time()
    result = verify_is_garbage(img)
    print(f'6. CLIP verify_is_garbage: {time.time()-t:.2f}s  result={result}', flush=True)
else:
    print('   No detections -> CLIP gate skipped', flush=True)
    print('   -> Task would return has_waste=False immediately', flush=True)

print('=== Test complete ===', flush=True)
"""

sftp = ssh.open_sftp()
with sftp.open("/tmp/test_inf.py", "w") as f:
    f.write(TEST_CODE)
sftp.close()

stdin, stdout, stderr = ssh.exec_command(
    "docker cp /tmp/test_inf.py emaseo-prod-ml-worker-1:/tmp/test_inf.py && "
    "timeout 120 docker exec emaseo-prod-ml-worker-1 python3 /tmp/test_inf.py 2>&1"
)
stdout.channel.recv_exit_status()
output = stdout.read().decode("utf-8", errors="replace")
print(output.encode('ascii', errors='replace').decode('ascii'))
ssh.close()
