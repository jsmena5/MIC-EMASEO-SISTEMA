import jwt, time, json, subprocess, sys

secret = subprocess.check_output(
    ['docker', 'exec', 'emaseo-gateway', 'printenv', 'JWT_SECRET']
).decode().strip()

users_raw = subprocess.check_output([
    'sh', '-c',
    "PGPASSWORD='Familiat3121040.' psql "
    "'host=db.racsklqvunereluevwfp.supabase.co port=5432 dbname=postgres user=postgres sslmode=require' "
    "-t -c \"SELECT id||'|'||email||'|'||rol FROM app_auth.users WHERE email LIKE 'stress%@emaseo.local' ORDER BY email;\" 2>/dev/null"
], stderr=subprocess.DEVNULL).decode()

tokens = []
for line in users_raw.strip().split('\n'):
    parts = line.strip().split('|')
    if len(parts) == 3:
        uid, email, rol = [p.strip() for p in parts]
        payload = dict(id=uid, email=email, rol=rol,
                       iat=int(time.time()), exp=int(time.time()) + 14400)
        tokens.append(jwt.encode(payload, secret, algorithm='HS256'))

print(json.dumps(tokens))
