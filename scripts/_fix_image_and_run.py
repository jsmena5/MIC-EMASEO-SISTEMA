"""Generate a valid 480x480 test image on VPS, then rebuild and run the stress test."""
import json, paramiko, base64, io, time

VPS_HOST = "95.111.234.82"
VPS_USER = "root"
VPS_PASS = "familiat"

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(VPS_HOST, username=VPS_USER, password=VPS_PASS, timeout=15)
print("Connected to VPS")

# ── Step 1: generate 480×480 JPEG in ml-worker container, copy to host ───────
print("Generating 480x480 test JPEG via ml-worker container...")
cmd_gen = (
    'docker exec emaseo-ml-worker python3 -c "'
    'import numpy as np, cv2; '
    'img = np.random.randint(40, 130, (480, 480, 3), dtype=np.uint8); '
    'cv2.imwrite(chr(47)+chr(116)+chr(109)+chr(112)+chr(47)+chr(116)+chr(103)+chr(46)+chr(106)+chr(112)+chr(103), img)"'
    ' && docker cp emaseo-ml-worker:/tmp/tg.jpg /tmp/test_garbage.jpg'
)
# Simpler: write a python file and run it
GEN_PY = """import numpy as np, cv2
img = np.random.randint(40, 130, (480, 480, 3), dtype=np.uint8)
cv2.imwrite('/tmp/tg.jpg', img)
print('ok')
"""
sftp = ssh.open_sftp()
with sftp.open("/tmp/gen_img.py", "w") as f:
    f.write(GEN_PY)
sftp.close()

# Copy gen_img.py into the container then run it, then copy result out
ML_WORKER = "emaseo-prod-ml-worker-1"
stdin, stdout, stderr = ssh.exec_command(
    f"docker cp /tmp/gen_img.py {ML_WORKER}:/tmp/gen_img.py && "
    f"docker exec {ML_WORKER} python3 /tmp/gen_img.py 2>&1 && "
    f"docker cp {ML_WORKER}:/tmp/tg.jpg /tmp/test_garbage.jpg && echo DONE"
)
# Wait for it
stdout.channel.recv_exit_status()
out = stdout.read().decode().strip()
err = stderr.read().decode().strip()
print("Image gen output:", out)
if err: print("Image gen stderr:", err[:200])

# Verify image exists and get its size
stdin2, stdout2, _ = ssh.exec_command("ls -la /tmp/test_garbage.jpg && python3 -c \"import struct; d=open('/tmp/test_garbage.jpg','rb').read(); print(len(d),'bytes')\"")
stdout2.channel.recv_exit_status()
print("File check:", stdout2.read().decode().strip())

# ── Step 2: read image as base64 ─────────────────────────────────────────────
sftp2 = ssh.open_sftp()
buf = io.BytesIO()
sftp2.getfo("/tmp/test_garbage.jpg", buf)
sftp2.close()
IMG_B64 = base64.b64encode(buf.getvalue()).decode()
print(f"Test image: {len(buf.getvalue())} bytes, {len(IMG_B64)} b64 chars")

# ── Step 3: load fresh tokens ─────────────────────────────────────────────────
with open(r"C:\REPOSITORIOS GITHUB\MIC-EMASEO-SISTEMA\_tokens.json") as f:
    tokens = json.load(f)
print(f"Using {len(tokens)} JWT tokens")

# ── Step 4: build corrected stress script ────────────────────────────────────
TOKENS_LINE = f"TOKENS = {json.dumps(tokens)}"
IMG_LINE    = f'IMG_B64 = "{IMG_B64}"'

SCRIPT = '''#!/usr/bin/env python3
"""EMASEO Stress Test Suite — 2026-06-03"""
import requests, threading, time, json, sys
from concurrent.futures import ThreadPoolExecutor, as_completed

BASE = "http://localhost:4000/api"
PASS = "StressTest2024!"
USERS = [f"stress{i:02d}@emaseo.local" for i in range(1, 31)]
''' + TOKENS_LINE + "\n" + IMG_LINE + r'''

RES  = {k: [] for k in ["login","precheck","submit","poll","historial","notif"]}
ERRS = {k: 0   for k in RES}
LOCK = threading.Lock()

def rec(key, t, err=False):
    with LOCK:
        if err: ERRS[key] += 1
        else:   RES[key].append(t)

def pct(lst, p):
    if not lst: return 0
    s = sorted(lst)
    return round(s[max(0, int(len(s)*p/100)-1)], 3)

def rep(key, label):
    v = RES[key]; e = ERRS[key]; n = len(v)+e
    if n == 0: return
    ok = round(100*len(v)/n, 1)
    if v:
        print(f"  {label:<30} n={n:>3}  ok={ok:>5}%  p50={pct(v,50):>6}s  p95={pct(v,95):>6}s  p99={pct(v,99):>6}s  err={e}")
    else:
        print(f"  {label:<30} n={n:>3}  ok=  0.0%  TODOS FALLARON")

def auth_hdr(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}

def do_login(email):
    t0 = time.time()
    try:
        r = requests.post(f"{BASE}/auth/login",
                          json={"email": email, "password": PASS}, timeout=15)
        t = time.time()-t0
        ok = r.status_code == 200
        rec("login", t, err=not ok)
        if not ok and r.status_code not in [429, 401]:
            print(f"  [login {r.status_code}] {email}: {r.text[:80]}")
        return r.json().get("token") if ok else None
    except Exception as ex:
        rec("login", time.time()-t0, err=True)
        return None

def do_precheck(tok):
    t0 = time.time()
    try:
        r = requests.post(f"{BASE}/ml/pre-check",
                          json={"image_base64": IMG_B64, "image_width": 480, "image_height": 480},
                          headers=auth_hdr(tok), timeout=25)
        ok = r.status_code in [200, 202]
        rec("precheck", time.time()-t0, err=not ok)
        if not ok:
            print(f"  [precheck {r.status_code}] {r.text[:120]}")
    except Exception as ex:
        rec("precheck", time.time()-t0, err=True)
        print(f"  [precheck EXC] {ex}")

def do_pipeline(tok, idx):
    t0 = time.time()
    try:
        r = requests.post(f"{BASE}/image/analyze",
                          json={"image": IMG_B64,
                                "latitude": -0.2295,
                                "longitude": -78.5243,
                                "client_coverage_ratio": 0.65,
                                "idempotency_key": f"st-{idx}-{int(time.time()*1000)}"},
                          headers=auth_hdr(tok), timeout=35)
        ok = r.status_code in [200, 201, 202]
        rec("submit", time.time()-t0, err=not ok)
        if not ok:
            print(f"  [submit {r.status_code}] idx={idx}: {r.text[:200]}")
            return r.status_code, None
        b = r.json()
        task_id = b.get("task_id") or b.get("taskId") or b.get("celery_task_id")
    except Exception as ex:
        rec("submit", time.time()-t0, err=True)
        print(f"  [submit EXC] idx={idx}: {ex}")
        return None, None

    if not task_id:
        print(f"  [no task_id] idx={idx} body={str(b)[:150]}")
        return None, None

    tp = time.time()
    for _ in range(120):
        time.sleep(2)
        try:
            s = requests.get(f"{BASE}/image/status/{task_id}",
                             headers={"Authorization": auth_hdr(tok)["Authorization"]},
                             timeout=10)
            if s.status_code == 200:
                d = s.json()
                state = (d.get("status") or d.get("estado") or
                         d.get("estado_incidente") or "")
                if state in ["PENDIENTE","DESCARTADO","EN_REVISION","RECHAZADA","FALLIDO"]:
                    rec("poll", time.time()-tp)
                    return state, time.time()-tp
        except: pass
    rec("poll", time.time()-tp, err=True)
    return "TIMEOUT", time.time()-tp

def do_historial(tok):
    t0 = time.time()
    try:
        r = requests.get(f"{BASE}/incidents/me",
                         headers={"Authorization": auth_hdr(tok)["Authorization"]},
                         timeout=10)
        rec("historial", time.time()-t0, err=(r.status_code != 200))
        if r.status_code != 200: print(f"  [historial {r.status_code}] {r.text[:80]}")
    except Exception as ex:
        rec("historial", time.time()-t0, err=True)

def do_notif(tok):
    t0 = time.time()
    try:
        r = requests.get(f"{BASE}/incidents/notifications",
                         headers={"Authorization": auth_hdr(tok)["Authorization"]},
                         timeout=10)
        rec("notif", time.time()-t0, err=(r.status_code != 200))
        if r.status_code != 200: print(f"  [notif {r.status_code}] {r.text[:80]}")
    except Exception as ex:
        rec("notif", time.time()-t0, err=True)

tokens = list(TOKENS)

# ══════════════════════════════════════════════════════════════════════════
print("\n" + "="*72)
print("FASE 0 — Verificacion login (1 intento real)")
print("="*72)
RES["login"] = []; ERRS["login"] = 0
do_login(USERS[0])
ok0 = len(RES["login"]) > 0
print(f"  Resultado: {'OK — endpoint responde' if ok0 else 'BLOQUEADO por IP limiter'}")
if ok0: rep("login", "Login real")
print(f"  Tokens JWT pre-firmados listos: {len(tokens)}")

# ══════════════════════════════════════════════════════════════════════════
print("\n" + "="*72)
print("FASE 1 — Auth burst: 30 logins simultaneos")
print("="*72)
RES["login"] = []; ERRS["login"] = 0
t0 = time.time()
with ThreadPoolExecutor(max_workers=30) as ex:
    futs = [ex.submit(do_login, u) for u in USERS]
    for f in as_completed(futs): f.result()
wall1 = time.time()-t0
n1_ok = len(RES["login"]); n1_err = ERRS["login"]
print(f"  Duracion: {wall1:.2f}s  |  OK={n1_ok}  429s={n1_err}")
print(f"  (429 = auth-svc IP limiter anti-fuerza-bruta, correcto)")
rep("login", "Auth endpoint")

# ══════════════════════════════════════════════════════════════════════════
print("\n" + "="*72)
print("FASE 2 — Pre-check burst: 60 simultaneos")
print("="*72)
RES["precheck"] = []; ERRS["precheck"] = 0
toks60 = (tokens * 3)[:60]
t0 = time.time()
with ThreadPoolExecutor(max_workers=60) as ex:
    futs = [ex.submit(do_precheck, t) for t in toks60]
    for f in as_completed(futs): f.result()
wall2 = time.time()-t0
print(f"  Duracion: {wall2:.2f}s  throughput: {round(60/wall2,1)} req/s")
rep("precheck", "Pre-check ML")

# ══════════════════════════════════════════════════════════════════════════
print("\n" + "="*72)
print("FASE 3 — Pipeline completo: 20 reportes simultaneos")
print("="*72)
RES["submit"] = []; ERRS["submit"] = 0
RES["poll"]   = []; ERRS["poll"]   = 0
toks20 = tokens[:20]
final_states = {}
t0 = time.time()
with ThreadPoolExecutor(max_workers=20) as ex:
    futs = {ex.submit(do_pipeline, toks20[i % len(toks20)], i): i for i in range(20)}
    for f in as_completed(futs):
        result = f.result()
        state = result[0] if result else None
        if state: final_states[futs[f]] = state
wall3 = time.time()-t0
sc = {}
for s in final_states.values(): sc[s] = sc.get(s, 0)+1
print(f"  Duracion total: {wall3:.1f}s")
print(f"  Estados finales: {sc}")
rep("submit", "Submit imagen (202)")
rep("poll",   "Pipeline ML completo")

# ══════════════════════════════════════════════════════════════════════════
print("\n" + "="*72)
print("FASE 4 — Carga sostenida: 1 pre-check/segundo x 30s")
print("="*72)
RES["precheck"] = []; ERRS["precheck"] = 0
t0 = time.time()
with ThreadPoolExecutor(max_workers=10) as ex:
    futs = []
    for i in range(30):
        futs.append(ex.submit(do_precheck, tokens[i % len(tokens)]))
        time.sleep(1)
    for f in as_completed(futs): f.result()
wall4 = time.time()-t0
ok4 = len(RES["precheck"])
print(f"  Duracion: {wall4:.1f}s  throughput: {round(ok4/wall4,2)} req/s exitosos")
rep("precheck", "Pre-check sostenido")

# ══════════════════════════════════════════════════════════════════════════
print("\n" + "="*72)
print("FASE 5 — REST endpoints: 30 historial + 30 notificaciones")
print("="*72)
RES["historial"] = []; ERRS["historial"] = 0
RES["notif"]     = []; ERRS["notif"]     = 0
t0 = time.time()
with ThreadPoolExecutor(max_workers=30) as ex:
    futs  = [ex.submit(do_historial, t) for t in tokens]
    futs += [ex.submit(do_notif,     t) for t in tokens]
    for f in as_completed(futs): f.result()
wall5 = time.time()-t0
print(f"  Duracion: {wall5:.2f}s")
rep("historial", "GET /incidents/me")
rep("notif",     "GET /notifications")

# ══════════════════════════════════════════════════════════════════════════
print("\n" + "="*72)
print("RESUMEN GLOBAL")
print("="*72)
all_ok  = sum(len(v) for v in RES.values())
all_err = sum(ERRS.values())
all_n   = all_ok + all_err
print(f"  Total requests : {all_n}")
print(f"  Exitosos       : {all_ok}  ({round(100*all_ok/all_n,1) if all_n else 0}%)")
print(f"  Errores        : {all_err}  ({round(100*all_err/all_n,1) if all_n else 0}%)")
print()
print("  Latencias (p50 / p95 / p99):")
for k, label in [("precheck","Pre-check (ML API)"),("submit","Submit imagen"),
                  ("poll","Pipeline ML completo"),("historial","Historial"),
                  ("notif","Notificaciones")]:
    v = RES[k]
    if v:
        print(f"    {label:<26}  p50={pct(v,50):>6}s  p95={pct(v,95):>6}s  "
              f"p99={pct(v,99):>6}s  n={len(v)+ERRS[k]}")
print()
'''

# ── Step 5: write and upload ──────────────────────────────────────────────────
with open(r"C:\REPOSITORIOS GITHUB\MIC-EMASEO-SISTEMA\stress_final.py", "w", encoding="utf-8") as f:
    f.write(SCRIPT)
print("stress_final.py written locally")

sftp3 = ssh.open_sftp()
sftp3.put(r"C:\REPOSITORIOS GITHUB\MIC-EMASEO-SISTEMA\stress_final.py", "/tmp/stress_test.py")
sftp3.close()
print("Uploaded to VPS")

# ── Step 6: run ───────────────────────────────────────────────────────────────
print("\nRunning stress test (Phase 3 takes ~10 min)...")
print("="*72)

channel = ssh.get_transport().open_session()
channel.get_pty()
channel.exec_command("python3 /tmp/stress_test.py 2>&1")

output = ""
while True:
    if channel.recv_ready():
        chunk = channel.recv(8192).decode("utf-8", errors="replace")
        print(chunk, end="", flush=True)
        output += chunk
    elif channel.exit_status_ready():
        while channel.recv_ready():
            chunk = channel.recv(8192).decode("utf-8", errors="replace")
            print(chunk, end="", flush=True)
            output += chunk
        break
    else:
        time.sleep(0.3)

exit_code = channel.recv_exit_status()
print(f"\n[exit code: {exit_code}]")

with open(r"C:\REPOSITORIOS GITHUB\MIC-EMASEO-SISTEMA\stress_results.txt", "w", encoding="utf-8") as f:
    f.write(output)
print("Results saved to stress_results.txt")

ssh.close()
