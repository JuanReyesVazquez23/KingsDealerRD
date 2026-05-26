# KingsDealer v6 — Railway Deploy

## Variables de entorno (OBLIGATORIAS en Railway)

Dashboard → tu proyecto → **Variables**:

| Variable     | Valor |
|---|---|
| `SECRET_KEY` | `python -c "import secrets; print(secrets.token_hex(32))"` |
| `ADMIN_USER` | tu usuario admin |
| `ADMIN_PASS` | tu contraseña admin |

## Subir a Railway

```bash
git add .
git commit -m "KingsDealer v6"
git push
```

Railway redeploya automáticamente. Las columnas nuevas de la DB
(`configuracion`, `anuncios_clientes`) se crean solas sin borrar nada.

## Subir DB y fotos

```bash
git add KingsDealer.db static/uploads/
git commit -m "Add DB and photos"
git push
```

## Local

```bash
pip install -r requirements.txt
cp .env.example .env   # editar con credenciales
python app.py
# → http://localhost:5000
```

## Novedades v6

- **Mapa configurable**: admin puede cambiar lat/lon desde el panel
- **Clientes publican su auto**: `/vender` con formulario en 3 pasos
- **Bancos de financiamiento**: acordeón con 6 bancos dominicanos reales
- **Diseño corporativo**: tipografía más formal, menos emojis decorativos
- **Panel de anuncios**: admin aprueba/rechaza publicaciones de clientes
