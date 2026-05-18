# KingsDealer PWA

Dealer de vehículos en Santo Domingo — ahora instalable como app.

## Estructura del proyecto

```
kingsdealer-pwa/
├── app.py                      ← Backend Flask (con rutas PWA añadidas)
├── KingsDealer.db              ← Base de datos SQLite
├── offline.html                ← Página sin conexión
├── requirements.txt
├── templates/
│   ├── base.html               ← Con meta tags PWA + registro SW
│   ├── index.html              ← Sin cambios
│   └── login.html              ← Sin cambios
└── static/
    ├── manifest.json           ← Configuración de la app instalable
    ├── sw.js                   ← Service Worker
    ├── css/style.css           ← Sin cambios
    ├── js/app.js               ← Sin cambios
    ├── icons/
    │   ├── icon-192.png
    │   └── icon-512.png
    └── uploads/                ← Imágenes de vehículos (vacío al inicio)
```

## Instalación local

```bash
pip install -r requirements.txt
python app.py
```
Abre: http://localhost:5000

## Despliegue en producción (PythonAnywhere / Render / Railway)

### PythonAnywhere (recomendado para principiantes)
1. Sube todos los archivos
2. Crea una Web App con Flask
3. Apunta el WSGI a `app.py`
4. La PWA funcionará automáticamente en HTTPS

### Render.com (gratuito)
1. Sube el proyecto a GitHub
2. Crea un nuevo Web Service en render.com
3. Build command: `pip install -r requirements.txt`
4. Start command: `gunicorn app:app`

## Cómo instalar la app en el teléfono

1. Abre el sitio en **Chrome** (Android) o **Safari** (iPhone)
2. Android: menú ⋮ → "Añadir a pantalla de inicio"
3. iPhone: botón compartir → "Añadir a pantalla de inicio"
4. La app aparece con el ícono de KingsDealer

## Lo que añade la PWA

- ✅ Instalable en pantalla de inicio
- ✅ Funciona offline (muestra página de sin conexión)
- ✅ Cachea CSS, JS y fuentes para carga más rápida
- ✅ Imágenes de vehículos se cachean al verlas
- ✅ API siempre va a red (datos siempre frescos)
- ✅ Ícono y splash screen con colores de KingsDealer
- ✅ Barra de estado del teléfono en rojo KingsDealer
