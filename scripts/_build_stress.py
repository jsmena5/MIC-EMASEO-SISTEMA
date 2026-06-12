"""Generates the final stress_final.py with tokens embedded, then uploads to VPS."""
import json, paramiko

with open(r"C:\REPOSITORIOS GITHUB\MIC-EMASEO-SISTEMA\_tokens.json") as f:
    tokens = json.load(f)

TOKENS_LINE = f"TOKENS = {json.dumps(tokens)}"

script = r'''#!/usr/bin/env python3
"""EMASEO Stress Test Suite - 2026-06-03"""
import requests, threading, time, base64, json, sys
from concurrent.futures import ThreadPoolExecutor, as_completed

BASE  = "http://localhost:4000/api"
PASS  = "StressTest2024!"
USERS = [f"stress{i:02d}@emaseo.local" for i in range(1, 31)]
''' + TOKENS_LINE + r'''

THUMB = base64.b64decode(
    "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDB"
    "kSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAAR"
    "CAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAA"
    "AAAAAAAAAAAAAP/EABQBAQAAAAAAAAAAAAAAAAAAAAD/xAAUEQEAAAAAAAAAAAAA"
    "AAAAAAAA/9oADAMBAAIRAxEAPwCwAB//2Q=="
)

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
    ok = round(100*len(v)/n,1) if n else 0
    if v:
        print(f"  {label:<30} n={n:>3}  ok={ok:>5}%  p50={pct(v,50):>6}s  p95={pct(v,95):>6}s  p99={pct(v,99):>6}s  err={e}")
    else:
        print(f"  {label:<30} n={n:>3}  ok=  0.0%  TODOS FALLARON")

def auth_hdr(tok): return {"Authorization": f"Bearer {tok}"}

def do_login(email):
    t0 = time.time()
    try:
        r = requests.post(f"{BASE}/auth/login",
                          json={"email": email, "password": PASS}, timeout=15)
        t = time.time()-t0
        ok = r.status_code == 200
        rec("login", t, err=not ok)
        if not ok and r.status_code != 429:
            print(f"  [login {r.status_code}] {email}: {r.text[:80]}")
        return r.json().get("token") if ok else None
    except Exception as ex:
        rec("login", time.time()-t0, err=True)
        return None

def do_precheck(tok):
    t0 = time.time()
    try:
        r = requests.post(f"{BASE}/ml/pre-check",
                          files={"image": ("t.jpg", THUMB, "image/jpeg")},
                          headers=auth_hdr(tok), timeout=20)
        ok = r.status_code in [200, 202]
        rec("precheck", time.time()-t0, err=not ok)
        if not ok: print(f"  [precheck {r.status_code}] {r.text[:80]}")
    except Exception as ex:
        rec("precheck", time.time()-t0, err=True)
        print(f"  [precheck EXC] {ex}")

def do_pipeline(tok, idx):
    t0 = time.time()
    try:
        r = requests.post(f"{BASE}/image/analyze",
                          files={"image": (f"img{idx}.jpg", THUMB, "image/jpeg")},
                          data={"latitud": "-0.2295", "longitud": "-78.5243",
                                "idempotency_key": f"st-{idx}-{int(time.time()*1000)}"},
                          headers=auth_hdr(tok), timeout=30)
        ok = r.status_code in [200, 201, 202]
        rec("submit", time.time()-t0, err=not ok)
        if not ok:
            print(f"  [submit {r.status_code}] idx={idx}: {r.text[:120]}")
            return r.status_code, None
        b = r.json()
        task_id = b.get("task_id") or b.get("taskId") or b.get("celery_task_id")
    except Exception as ex:
        rec("submit", time.time()-t0, err=True)
        print(f"  [submit EXC] idx={idx}: {ex}")
        return None, None

    if not task_id:
        print(f"  [no task_id] body={str(r.json())[:100]}")
        return None, None

    tp = time.time()
    for _ in range(120):
        time.sleep(2)
        try:
            s = requests.get(f"{BASE}/image/status/{task_id}",
                             headers=auth_hdr(tok), timeout=10)
            if s.status_code == 200:
                d = s.json()
                state = d.get("status") or d.get("estado") or d.get("estado_incidente","")
                if state in ["PENDIENTE","DESCARTADO","EN_REVISION","RECHAZADA","FALLIDO"]:
                    rec("poll", time.time()-tp)
                    return state, time.time()-tp
        except: pass
    rec("poll", time.time()-tp, err=True)
    return "TIMEOUT", time.time()-tp

def do_historial(tok):
    t0 = time.time()
    try:
        r = requests.get(f"{BASE}/incidents/me", headers=auth_hdr(tok), timeout=10)
        rec("historial", time.time()-t0, err=(r.status_code != 200))
        if r.status_code != 200: print(f"  [historial {r.status_code}]")
    except Exception as ex:
        rec("historial", time.time()-t0, err=True)

def do_notif(tok):
    t0 = time.time()
    try:
        r = requests.get(f"{BASE}/incidents/notifications",
                         headers=auth_hdr(tok), timeout=10)
        rec("notif", time.time()-t0, err=(r.status_code != 200))
        if r.status_code != 200: print(f"  [notif {r.status_code}]")
    except Exception as ex:
        rec("notif", time.time()-t0, err=True)

tokens = list(TOKENS)

# ══════════════════════════════════════════════════════════════════════════
print("\n" + "="*70)
print("FASE 0 — Verificacion endpoint login (1 intento real)")
print("="*70)
RES["login"] = []; ERRS["login"] = 0
t0 = time.time()
# Auth-service has own in-memory IP limiter (5/15min). We test 1 to verify
# endpoint is alive. Full-load auth tested in FASE 1 (429 response latency).
do_login(USERS[0])
print(f"  Resultado: {'OK' if RES['login'] else 'BLOQUEADO por IP limiter (esperado en loopback)'}")
if RES["login"]: rep("login", "Login real")
print(f"  Tokens JWT pre-firmados listos: {len(tokens)}")

# ══════════════════════════════════════════════════════════════════════════
print("\n" + "="*70)
print("FASE 1 — Auth burst: 30 logins simultaneos")
print("="*70)
RES["login"] = []; ERRS["login"] = 0
t0 = time.time()
with ThreadPoolExecutor(max_workers=30) as ex:
    futs = [ex.submit(do_login, u) for u in USERS]
    for f in as_completed(futs): f.result()
wall1 = time.time()-t0
print(f"  Duracion: {wall1:.2f}s")
print(f"  (429 = auth-svc IP limiter, correcto para anti-fuerza-bruta)")
rep("login", "Auth endpoint")

# ══════════════════════════════════════════════════════════════════════════
print("\n" + "="*70)
print("FASE 2 — Pre-check burst: 60 simultaneos")
print("="*70)
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
print("\n" + "="*70)
print("FASE 3 — Pipeline completo: 20 reportes simultaneos")
print("="*70)
RES["submit"] = []; ERRS["submit"] = 0
RES["poll"]   = []; ERRS["poll"]   = 0
toks20 = tokens[:20]
final_states = {}
t0 = time.time()
with ThreadPoolExecutor(max_workers=20) as ex:
    futs = {ex.submit(do_pipeline, toks20[i % len(toks20)], i): i for i in range(20)}
    for f in as_completed(futs):
        state, elapsed = f.result()
        if state: final_states[futs[f]] = state
wall3 = time.time()-t0
sc = {}
for s in final_states.values(): sc[s] = sc.get(s, 0)+1
print(f"  Duracion total: {wall3:.1f}s")
print(f"  Estados finales: {sc}")
rep("submit", "Submit imagen (202)")
rep("poll",   "Pipeline ML completo")

# ══════════════════════════════════════════════════════════════════════════
print("\n" + "="*70)
print("FASE 4 — Carga sostenida: 1 pre-check/segundo x 30s")
print("="*70)
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
print("\n" + "="*70)
print("FASE 5 — REST endpoints: 30 historial + 30 notificaciones")
print("="*70)
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
print("\n" + "="*70)
print("RESUMEN GLOBAL")
print("="*70)
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

with open(r"C:\REPOSITORIOS GITHUB\MIC-EMASEO-SISTEMA\stress_final.py", "w", encoding="utf-8") as f:
    f.write(script)
print("stress_final.py written")

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect("95.111.234.82", username="root", password="familiat", timeout=15)
sftp = ssh.open_sftp()
sftp.put(r"C:\REPOSITORIOS GITHUB\MIC-EMASEO-SISTEMA\stress_final.py", "/tmp/stress_test.py")
sftp.close()
print("Uploaded to VPS")
ssh.close()
