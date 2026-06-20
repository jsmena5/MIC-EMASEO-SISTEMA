"""Upload and run a 5-task pipeline timing test on VPS."""
import paramiko, json, base64, io, time

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect("95.111.234.82", username="root", password="familiat", timeout=15)

with open(r"C:\REPOSITORIOS GITHUB\MIC-EMASEO-SISTEMA\_tokens.json") as f:
    tokens = json.load(f)

buf = io.BytesIO()
sftp = ssh.open_sftp()
sftp.getfo("/tmp/test_garbage.jpg", buf)
sftp.close()
img_b64 = base64.b64encode(buf.getvalue()).decode()

# Build the remote script as a plain string
lines = [
    "#!/usr/bin/env python3",
    "import requests, time",
    "from concurrent.futures import ThreadPoolExecutor, as_completed",
    "",
    'BASE = "http://localhost:4000/api"',
    "TOKENS = " + json.dumps(tokens),
    'IMG_B64 = "' + img_b64 + '"',
    "",
    "def auth_hdr(t):",
    '    return {"Authorization": f"Bearer {t}"}',
    "",
    "def pipeline(tok, idx):",
    "    t0 = time.time()",
    "    r = requests.post(f\"{BASE}/image/analyze\",",
    '        json={"image": IMG_B64, "latitude": -0.2295, "longitude": -78.5243,',
    '               "client_coverage_ratio": 0.65,',
    '               "idempotency_key": f"pipe-{idx}-{int(time.time()*1000)}"},',
    "        headers=auth_hdr(tok), timeout=35)",
    "    submit_t = round(time.time()-t0, 3)",
    "    if r.status_code not in [200,201,202]:",
    '        print(f"  [{idx}] submit FAIL {r.status_code}: {r.text[:150]}")',
    "        return None",
    "    b = r.json()",
    '    task_id = b.get("task_id") or b.get("taskId") or b.get("celery_task_id")',
    '    print(f"  [{idx}] submitted {r.status_code} in {submit_t}s task_id={task_id}")',
    "    if not task_id: return None",
    "",
    "    tp = time.time()",
    "    for attempt in range(300):",
    "        time.sleep(2)",
    "        try:",
    "            s = requests.get(f\"{BASE}/image/status/{task_id}\", headers=auth_hdr(tok), timeout=10)",
    "            if s.status_code == 200:",
    "                d = s.json()",
    '                state = d.get("status") or d.get("estado") or d.get("estado_incidente","")',
    "                if attempt % 15 == 0 and attempt > 0:",
    '                    print(f"  [{idx}] poll {attempt*2}s: state={state}")',
    '                if state in ["PENDIENTE","DESCARTADO","EN_REVISION","RECHAZADA","FALLIDO","RESUELTA"]:',
    "                    elapsed = round(time.time()-tp, 1)",
    '                    print(f"  [{idx}] DONE state={state} pipeline_time={elapsed}s")',
    "                    return (state, elapsed)",
    "        except: pass",
    '    print(f"  [{idx}] TIMEOUT after 600s")',
    '    return ("TIMEOUT", 600)',
    "",
    'print("\\nPipeline test: 5 concurrent submissions")',
    'print("="*55)',
    "toks5 = TOKENS[:5]",
    "t0 = time.time()",
    "with ThreadPoolExecutor(max_workers=5) as ex:",
    "    futs = {ex.submit(pipeline, toks5[i], i): i for i in range(5)}",
    "    results = {futs[f]: f.result() for f in as_completed(futs)}",
    "wall = time.time()-t0",
    'print(f"\\nCompleted in {wall:.1f}s")',
    "for idx, res in sorted(results.items()):",
    '    print(f"  Task {idx}: {res}")',
    "states = [r[0] for r in results.values() if r]",
    "times  = [r[1] for r in results.values() if r and r[0] != 'TIMEOUT']",
    "if times:",
    "    times.sort()",
    '    print(f"\\nE2E pipeline latency (submit 202 -> terminal state):")',
    '    print(f"  min={times[0]}s  median={times[len(times)//2]}s  max={times[-1]}s")',
    "    sc = {}",
    "    for s in states: sc[s] = sc.get(s,0)+1",
    '    print(f"  states: {sc}")',
]

remote_script = "\n".join(lines) + "\n"

sftp2 = ssh.open_sftp()
with sftp2.open("/tmp/pipeline_test.py", "w") as f:
    f.write(remote_script)
sftp2.close()
print("Uploaded pipeline_test.py. Running (up to 10 min)...")

channel = ssh.get_transport().open_session()
channel.get_pty()
channel.exec_command("python3 /tmp/pipeline_test.py 2>&1")

output = ""
while True:
    if channel.recv_ready():
        chunk = channel.recv(4096).decode("utf-8", errors="replace")
        print(chunk, end="", flush=True)
        output += chunk
    elif channel.exit_status_ready():
        while channel.recv_ready():
            chunk = channel.recv(4096).decode("utf-8", errors="replace")
            print(chunk, end="", flush=True)
            output += chunk
        break
    else:
        time.sleep(0.3)

print(f"\n[exit: {channel.recv_exit_status()}]")

with open(r"C:\REPOSITORIOS GITHUB\MIC-EMASEO-SISTEMA\pipeline_results.txt", "w", encoding="utf-8") as f:
    f.write(output)

ssh.close()
