"""Upload and run pipeline fix verification on VPS."""
import paramiko, json, base64, io, time

SCRIPT = r"""
import requests, time, json, base64
from concurrent.futures import ThreadPoolExecutor, as_completed

BASE = "http://localhost:4000/api"

with open("/tmp/tokens.json") as f:
    TOKENS = json.load(f)[:3]

with open("/tmp/test_garbage.jpg", "rb") as f:
    IMG_B64 = base64.b64encode(f.read()).decode()

def pipeline(tok, idx):
    t0 = time.time()
    r = requests.post(f"{BASE}/image/analyze",
        json={"image": IMG_B64, "latitude": -0.2295, "longitude": -78.5243,
               "client_coverage_ratio": 0.65,
               "idempotency_key": f"fixtest-{idx}-{int(time.time()*1000)}"},
        headers={"Authorization": f"Bearer {tok}"}, timeout=35)
    if r.status_code not in [200, 201, 202]:
        print(f"  [{idx}] SUBMIT FAIL {r.status_code}: {r.text[:100]}", flush=True)
        return f"SUBMIT_FAIL_{r.status_code}"
    b = r.json()
    task_id = b.get("task_id") or b.get("taskId") or b.get("celery_task_id")
    print(f"  [{idx}] submitted {r.status_code} in {time.time()-t0:.1f}s  task={task_id}", flush=True)
    if not task_id:
        return "NO_TASK_ID"
    for attempt in range(45):
        time.sleep(2)
        try:
            s = requests.get(f"{BASE}/image/status/{task_id}",
                headers={"Authorization": f"Bearer {tok}"}, timeout=10)
            if s.status_code == 200:
                d = s.json()
                state = (d.get("status") or d.get("estado")
                         or d.get("estado_incidente") or "")
                if attempt % 10 == 0 and attempt > 0:
                    print(f"  [{idx}] poll {attempt*2}s state={state}", flush=True)
                if state in ["PENDIENTE", "DESCARTADO", "EN_REVISION",
                             "RECHAZADA", "FALLIDO", "RESUELTA"]:
                    elapsed = round(time.time() - t0, 1)
                    print(f"  [{idx}] DONE state={state} total={elapsed}s", flush=True)
                    return state
        except Exception as e:
            pass
    return "TIMEOUT_90s"

print("=== Pipeline fix verification (3 tasks, max 90s each) ===", flush=True)
with ThreadPoolExecutor(max_workers=3) as ex:
    futs = {ex.submit(pipeline, TOKENS[i], i): i for i in range(3)}
    results = {futs[f]: f.result() for f in as_completed(futs)}

print("Results:", json.dumps(results, indent=2), flush=True)
"""

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect("95.111.234.82", username="root", password="familiat", timeout=15)

# Upload tokens and script
with open(r"C:\REPOSITORIOS GITHUB\MIC-EMASEO-SISTEMA\_tokens.json") as f:
    tokens_data = f.read()

sftp = ssh.open_sftp()
with sftp.open("/tmp/tokens.json", "w") as f:
    f.write(tokens_data)
with sftp.open("/tmp/verify_fix.py", "w") as f:
    f.write(SCRIPT)
sftp.close()

print("Running pipeline fix verification (3 tasks, ~90s timeout each)...")
channel = ssh.get_transport().open_session()
channel.get_pty()
channel.exec_command("python3 /tmp/verify_fix.py 2>&1")

output = ""
while True:
    if channel.recv_ready():
        chunk = channel.recv(4096).decode("utf-8", errors="replace")
        safe = chunk.encode("ascii", errors="replace").decode("ascii")
        print(safe, end="", flush=True)
        output += chunk
    elif channel.exit_status_ready():
        while channel.recv_ready():
            chunk = channel.recv(4096).decode("utf-8", errors="replace")
            safe = chunk.encode("ascii", errors="replace").decode("ascii")
            print(safe, end="", flush=True)
            output += chunk
        break
    else:
        time.sleep(0.3)

print(f"\n[exit: {channel.recv_exit_status()}]")
ssh.close()
