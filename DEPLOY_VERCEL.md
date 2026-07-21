# Publicar en Vercel

## 1. Subir a GitHub

Sube el contenido de esta carpeta como repositorio. Los archivos `.env`, `env.js`, `.vercel/` y `dist/` no deben subirse.

## 2. Importar el repositorio

En Vercel selecciona **Add New → Project**, importa el repositorio y deja que lea `vercel.json`.

Si esta carpeta vive dentro de un repositorio mayor, configura **Root Directory** con la ruta de `FORMATOS DIGITALES`. Si ésta es la raíz del repositorio, no cambies ese campo.

## 3. Variables de entorno

En **Project Settings → Environment Variables**, agrega las siguientes variables para Production y Preview:

- `SUPABASE_URL`: URL HTTPS del proyecto Supabase.
- `SUPABASE_PUBLISHABLE_KEY`: publishable key (`sb_publishable_...`), nunca la `service_role` ni una `sb_secret_...`.

Después pulsa **Deploy**. El build genera `dist/env.js` sin guardar los valores en GitHub.

## 4. Supabase Auth

Cuando Vercel entregue la URL final, agrégala en Supabase en **Authentication → URL Configuration**:

- **Site URL**: `https://tu-proyecto.vercel.app`
- **Redirect URLs**: `https://tu-proyecto.vercel.app/**`

Agrega también el dominio propio si posteriormente conectas uno.

## 5. Prueba después del despliegue

1. Abre la URL en una ventana privada.
2. Inicia sesión con un usuario de Supabase.
3. Crea un Material Delivery Record.
4. Confirma que aparece en el historial.
5. Edítalo y guarda una nueva versión.
6. Descarga el Excel y confirma que usa el formato unificado.

Si Vercel indica que faltan variables, agrégalas al ambiente correspondiente y ejecuta **Redeploy**.
