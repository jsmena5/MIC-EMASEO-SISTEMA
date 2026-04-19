INSERT INTO auth.users (id, email, username, password_hash, rol, estado, is_verified)
VALUES (
  'aaaaaaaa-0000-0000-0000-000000000099',
  'qa.test@emaseo.local',
  'qa.test',
  crypt('QaTest2024', gen_salt('bf')),
  'CIUDADANO',
  'ACTIVO',
  TRUE
) ON CONFLICT (id) DO NOTHING;

INSERT INTO public.ciudadanos (user_id, nombre, apellido, cedula, telefono)
VALUES (
  'aaaaaaaa-0000-0000-0000-000000000099',
  'QA',
  'Test',
  '1700000001',
  '0990000001'
) ON CONFLICT (user_id) DO NOTHING;

SELECT username, email, rol, is_verified FROM auth.users WHERE username = 'qa.test';
