# Tesis System - App Móvil + Microservicios
# Descripción

Sistema desarrollado como proyecto de tesis que permite el registro de usuarios desde una aplicación móvil construida con React Native (Expo), conectada a un microservicio en Node.js con base de datos PostgreSQL.

# Arquitectura
📱 Frontend: React Native (Expo)
🌐 Backend: Node.js + Express
🐘 Base de datos: PostgreSQL
🔗 Comunicación: Axios (HTTP REST)
#  Estructura del proyecto
tesis sistem/
│
├── frontend/        # Aplicación móvil (Expo)
└── backend/
    └── users-service/   # Microservicio de usuarios
# Requisitos
Node.js (v18+ recomendado)
PostgreSQL
Expo Go (en celular)
Git
# Configuración de la Base de Datos

# Crear la base de datos y tabla:

CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(100),
  apellido VARCHAR(100),
  cedula VARCHAR(10),
  username VARCHAR(50) UNIQUE,
  email VARCHAR(100) UNIQUE,
  password VARCHAR(100),
  ciudad VARCHAR(100),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
# Configuración del Backend
cd backend/users-service
npm install
npm run dev

El servidor correrá en:

http://localhost:3000

#  Configuración del Frontend
cd frontend
npm install
npx expo start

# Configurar conexión con backend

En el archivo:

src/utils/api.ts

Colocar tu IP local:

const api = axios.create({
  baseURL: "http://TU_IP:3000/api",
  timeout: 5000
})

Para obtener tu IP:

# ipconfig

Ejemplo:

192.168.1.10
#  Ejecución
Ejecutar backend
Ejecutar frontend
Abrir Expo Go en el celular
Escanear QR
Registrar usuario

# Notas importantes
El celular y la PC deben estar en la misma red WiFi
No usar localhost en el frontend
Verificar que el puerto 3000 esté activo

# Funcionalidades actuales
Registro de usuarios
Validaciones en frontend
Persistencia en PostgreSQL
