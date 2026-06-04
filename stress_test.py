#!/usr/bin/env python3
"""
EMASEO Stress Test Suite — 2026-06-03
Tests: auth, pre-check, full ML pipeline, sustained load, REST endpoints
"""
import requests, threading, time, base64, json, statistics, sys
from concurrent.futures import ThreadPoolExecutor, as_completed

BASE  = "https://micemaseo.duckdns.org/api"
PASS  = "StressTest2024!"
USERS = [f"stress{i:02d}@emaseo.local" for i in range(1, 31)]

# Minimal valid 1x1 JPEG (for thumbnail pre-check)
THUMB_JPG = base64.b64decode(
    "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDB"
    "kSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAAR"
    "CAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAA"
    "AAAAAAAAAAAAAP/EABQBAQAAAAAAAAAAAAAAAAAAAAD/xAAUEQEAAAAAAAAAAAAA"
    "AAAAAAAA/9oADAMBAAIRAxEAPwCwAB//2Q=="
)

results = {k: [] for k in ["login","precheck","submit","poll_first","poll_total","historial","notif"]}
errors  = {k: 0  for k in results}
lock    = threading.Lock()

def rec(key, t, err=False):
    with lock:
        if err: errors[key] += 1
        else:   results[key].append(t)

def login(email):
    t0 = time.time()
    try:
        r = requests.post(f"{BASE}/auth/login",
            json={"email": email, "password": PASS}, timeout=15)
        t = time.time() - t0
        if r.status_code == 200:
            body = r.json()
            rec("login", t)
            return body.get("token") or body.get("accessToken")
        rec("login", t, err=True)
        print(f"  [login FAIL {r.status_code}] {email}: {r.text[:80]}")
    except Exception as e:
        rec("login", time.time()-t0, err=True)
        print(f"  [login EXC] {email}: {e}")
    return None

def precheck(token):
    t0 = time.time()
    try:
        r = requests.post(f"{BASE}/ml/pre-check",
            files={"image": ("thumb.jpg", THUMB_JPG, "image/jpeg")},
            headers={"Authorization": f"Bearer {token}"}, timeout=20)
        rec("precheck", time.time()-t0, err=(r.status_code not in [200,202]))
        if r.status_code not in [200,202]:
            print(f"  [precheck {r.status_code}] {r.text[:80]}")
    except Exception as e:
        rec("precheck", time.time()-t0, err=True)
        print(f"  [precheck EXC] {e}")

def submit_and_poll(token, idx):
    t0 = time.time()
    try:
        r = requests.post(f"{BASE}/image/analyze",
            files={"image": (f"img{idx}.jpg", THUMB_JPG, "image/jpeg")},
            data={
                "latitud": "-0.2295", "longitud": "-78.5243",
                "idempotency_key": f"stress-{idx}-{int(time.time()*1000)}"
            },
            headers={"Authorization": f"Bearer {token}"}, timeout=30)
        submit_t = time.time() - t0
        rec("submit", submit_t, err=(r.status_code not in [200,201,202]))
        if r.status_code not in [200,201,202]:
            print(f"  [submit {r.status_code}] idx={idx}: {r.text[:120]}")
            return r.status_code, None
        body = r.json()
        task_id = body.get("task_id") or body.get("taskId") or body.get("celery_task_id")
    except Exception as e:
        rec("submit", time.time()-t0, err=True)
        print(f"  [submit EXC] idx={idx}: {e}")
        return None, None

    if not task_id:
        print(f"  [submit NO TASK_ID] idx={idx} body={str(r.json())[:120]}")
        return None, None

    t_poll = time.time()
    first_done = False
    for attempt in range(120):
        time.sleep(2)
        try:
            s = requests.get(f"{BASE}/image/status/{task_id}",
                headers={"Authorization": f"Bearer {token}"}, timeout=10)
            if s.status_code == 200:
                data  = s.json()
                state = data.get("status") or data.get("estado") or data.get("estado_incidente","")
                if not first_done:
                    rec("poll_first", time.time()-t_poll)
                    first_done = True
                if state in ["PENDIENTE","DESCARTADO","EN_REVISION","RECHAZADA","FALLIDO"]:
                    elapsed = time.time()-t_poll
                    rec("poll_total", elapsed)
                    return state, elapsed
        except Exception:
            pass
    rec("poll_total", time.time()-t_poll, err=True)
    return "TIMEOUT", time.time()-t_poll

def check_historial(token):
    t0 = time.time()
    try:
        r = requests.get(f"{BASE}/incidents/me",
            headers={"Authorization": f"Bearer {token}"}, timeout=10)
        rec("historial", time.time()-t0, err=(r.status_code!=200))
    except Exception:
        rec("historial", time.time()-t0, err=True)

def check_notif(token):
    t0 = time.time()
    try:
        r = requests.get(f"{BASE}/incidents/notifications",
            headers={"Authorization": f"Bearer {token}"}, timeout=10)
        rec("notif", time.time()-t0, err=(r.status_code!=200))
    except Exception:
        rec("notif", time.time()-t0, err=True)

def pct(lst, p):
    if not lst: return 0
    s = sorted(lst)
    idx = max(0, int(len(s)*p/100) - 1)
    return round(s[idx], 3)

def report(key, label):
    vals = results[key]; errs = errors[key]
    total = len(vals) + errs
    if total == 0: return
    ok_pct = round(100*len(vals)/total, 1)
    if vals:
        print(f"  {label:<30} n={total:>3}  ok={ok_pct:>5}%  "
              f"p50={pct(vals,50):>6}s  p95={pct(vals,95):>6}s  "
              f"p99={pct(vals,99):>6}s  errors={errs}")
    else:
        print(f"  {label:<30} n={total:>3}  ok=  0.0%  ALL ERRORS ({errs})")

# =============================================================================
print("\n" + "="*72)
print("FASE 0 — Login inicial de 30 usuarios (obtener tokens)")
print("="*72)
tokens = []
t0 = time.time()
with ThreadPoolExecutor(max_workers=30) as ex:
    futs = {ex.submit(login, u): u for u in USERS}
    for f in as_completed(futs):
        tok = f.result()
        if tok: tokens.append(tok)
print(f"  Tokens obtenidos: {len(tokens)}/30  en {time.time()-t0:.2f}s")

if len(tokens) < 5:
    print("ERROR: demasiados fallos de login. Abortando.")
    sys.exit(1)

# =============================================================================
print("\n" + "="*72)
print("FASE 1 — Auth burst: 30 logins simultáneos")
print("="*72)
results["login"] = []; errors["login"] = 0
t0 = time.time()
with ThreadPoolExecutor(max_workers=30) as ex:
    futs = [ex.submit(login, u) for u in USERS]
    for f in as_completed(futs): f.result()
wall1 = time.time()-t0
print(f"  Duración: {wall1:.2f}s")
report("login", "Login")

# =============================================================================
print("\n" + "="*72)
print("FASE 2 — Pre-check burst: 60 simultáneos")
print("="*72)
results["precheck"] = []; errors["precheck"] = 0
toks60 = (tokens * 3)[:60]
t0 = time.time()
with ThreadPoolExecutor(max_workers=60) as ex:
    futs = [ex.submit(precheck, t) for t in toks60]
    for f in as_completed(futs): f.result()
wall2 = time.time()-t0
print(f"  Duración: {wall2:.2f}s  ({round(60/wall2,1)} req/s)")
report("precheck", "Pre-check ML")

# =============================================================================
print("\n" + "="*72)
print("FASE 3 — Pipeline completo: 20 reportes simultáneos (submit + poll)")
print("="*72)
results["submit"] = []; errors["submit"] = 0
results["poll_first"] = []; errors["poll_first"] = 0
results["poll_total"] = []; errors["poll_total"] = 0
toks20 = tokens[:min(20, len(tokens))]
final_states = {}
t0 = time.time()
with ThreadPoolExecutor(max_workers=20) as ex:
    futs = {ex.submit(submit_and_poll, toks20[i % len(toks20)], i): i for i in range(20)}
    for f in as_completed(futs):
        state, elapsed = f.result()
        if state: final_states[futs[f]] = state
wall3 = time.time()-t0
state_counts = {}
for s in final_states.values():
    state_counts[s] = state_counts.get(s, 0) + 1
print(f"  Duración total: {wall3:.1f}s")
print(f"  Estados finales: {state_counts}")
report("submit",      "Submit (202)")
report("poll_first",  "Primera resp. poll")
report("poll_total",  "Pipeline completo")

# =============================================================================
print("\n" + "="*72)
print("FASE 4 — Carga sostenida: 1 pre-check/segundo durante 30s")
print("="*72)
results["precheck"] = []; errors["precheck"] = 0
t0 = time.time()
with ThreadPoolExecutor(max_workers=10) as ex:
    futs = []
    for i in range(30):
        futs.append(ex.submit(precheck, tokens[i % len(tokens)]))
        time.sleep(1)
    for f in as_completed(futs): f.result()
wall4 = time.time()-t0
print(f"  Duración: {wall4:.2f}s  ({round(30/wall4,2)} req/s efectivos)")
report("precheck", "Pre-check sostenido")

# =============================================================================
print("\n" + "="*72)
print("FASE 5 — Endpoints REST: 30 historial + 30 notificaciones concurrentes")
print("="*72)
results["historial"] = []; errors["historial"] = 0
results["notif"]     = []; errors["notif"]     = 0
t0 = time.time()
with ThreadPoolExecutor(max_workers=30) as ex:
    futs  = [ex.submit(check_historial, t) for t in tokens]
    futs += [ex.submit(check_notif,     t) for t in tokens]
    for f in as_completed(futs): f.result()
wall5 = time.time()-t0
print(f"  Duración: {wall5:.2f}s")
report("historial", "GET /incidents/me")
report("notif",     "GET /notifications")

# =============================================================================
print("\n" + "="*72)
print("RESUMEN GLOBAL")
print("="*72)
all_ok  = sum(len(v) for v in results.values())
all_err = sum(errors.values())
all_tot = all_ok + all_err
print(f"  Total requests : {all_tot}")
print(f"  Exitosos       : {all_ok}  ({round(100*all_ok/all_tot,1) if all_tot else 0}%)")
print(f"  Errores        : {all_err}  ({round(100*all_err/all_tot,1) if all_tot else 0}%)")
print()
print("  Latencias por endpoint (p50 / p95 / p99):")
for k, label in [
    ("login",      "Login (auth)"),
    ("precheck",   "Pre-check (ML API)"),
    ("submit",     "Submit imagen"),
    ("poll_total", "Pipeline ML completo"),
    ("historial",  "Historial ciudadano"),
    ("notif",      "Notificaciones"),
]:
    v = results[k]
    if v:
        print(f"    {label:<24}  p50={pct(v,50):>6}s  p95={pct(v,95):>6}s  "
              f"p99={pct(v,99):>6}s  n={len(v)+errors[k]}")
print()
