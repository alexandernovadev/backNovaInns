# Nova Inns Apartments — Backend API

Sistema de gestión para apartamentos de alquiler corto. Permite administrar el inventario de propiedades, reservas, huéspedes y el flujo de pagos del negocio.

## Tecnologías

- **NestJS** — framework backend
- **MongoDB + Mongoose** — base de datos
- **JWT + Passport** — autenticación
- **TypeScript**

## Módulos

| Módulo | Descripción |
|--------|-------------|
| `auth` | Login y generación de token JWT |
| `users` | Gestión del equipo con roles (SUPER_ADMIN, ADMIN, STAFF, GUEST) |
| `apartments` | Inventario detallado de propiedades y equipamiento |
| `bookings` | Reservas, registro de huéspedes y control de pagos |

## Variables de entorno

Crear un archivo `.env` en la raíz del proyecto:

```env
MONGODB_URI=mongodb://localhost:27017/nova-inns
JWT_SECRET=tu_secreto_aqui
JWT_EXPIRES_IN=7d
PORT=3000
```

## Correr el proyecto

```bash
# Instalar dependencias
npm install

# Desarrollo
npm run start:dev

# Producción
npm run start:prod
```

## Autor

**Nova Alex Labs**
