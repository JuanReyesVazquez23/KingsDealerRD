"""
KingsDealer - Flask Backend v6 (PostgreSQL Version)
+ Tabla configuracion (mapa lat/lon configurable por admin)
+ Tabla anuncios_clientes (clientes pueden publicar su auto)
+ Rutas /vender y /api/anuncios
"""

import os
import json
import psycopg2
from psycopg2.extras import RealDictCursor
import hashlib
import secrets
import re
from functools import wraps
from flask import (
    Flask, render_template, request, redirect,
    url_for, session, jsonify, send_from_directory
)
from werkzeug.utils import secure_filename
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)

_secret = os.environ.get("SECRET_KEY")
if not _secret:
    raise RuntimeError("Variable de entorno SECRET_KEY no definida.")
app.secret_key = _secret

UPLOAD_FOLDER = os.path.join(app.root_path, 'static', 'uploads')
ALLOWED_EXTENSIONS  = {'png', 'jpg', 'jpeg', 'webp', 'gif'}
MAX_CONTENT_LENGTH  = 8 * 1024 * 1024 * 20   # 20 fotos × 8 MB máx
app.config['UPLOAD_FOLDER']      = UPLOAD_FOLDER
app.config['MAX_CONTENT_LENGTH'] = MAX_CONTENT_LENGTH

# Railway inyecta automáticamente la variable DATABASE_URL cuando vinculas la base de datos
DATABASE_URL = os.environ.get("DATABASE_URL", "")
# Railway inyecta "postgres://" pero psycopg2 >= 2.9 necesita "postgresql://"
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

_admin_user = os.environ.get("ADMIN_USER")
_admin_pass = os.environ.get("ADMIN_PASS")
if not _admin_user or not _admin_pass:
    raise RuntimeError("Variables ADMIN_USER y/o ADMIN_PASS no definidas.")

ADMIN_USER      = _admin_user
ADMIN_PASS_HASH = hashlib.sha256(_admin_pass.encode()).hexdigest()


# ══════════════════════════════════════════════════════════════════
# BASE DE DATOS (POSTGRESQL ADAPTER)
# ══════════════════════════════════════════════════════════════════

class PostgresConnection:
    """Clase de ayuda para mantener la sintaxis limpia de tu app original"""
    def __init__(self, url):
        self.url = url
        self.conn = None
        self.cur = None

    def __enter__(self):
        self.conn = psycopg2.connect(self.url, cursor_factory=RealDictCursor)
        self.cur = self.conn.cursor()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        if exc_type:
            self.conn.rollback()
        else:
            self.conn.commit()
        self.cur.close()
        self.conn.close()

    def execute(self, query, params=None):
        # Convierte el marcador de posición '?' de SQLite al '%s' de PostgreSQL
        query = query.replace('?', '%s')
        # psycopg2 no acepta lista vacía si no hay placeholders — normalizar
        if params is not None and len(params) == 0:
            self.cur.execute(query)
        else:
            self.cur.execute(query, params or None)
        return self.cur


def get_db():
    return PostgresConnection(DATABASE_URL)


def init_db():
    os.makedirs(UPLOAD_FOLDER, exist_ok=True)
    with get_db() as conn:
        # ── Tabla principal de vehículos ──
        conn.execute('''
            CREATE TABLE IF NOT EXISTS vehiculos (
                id            SERIAL PRIMARY KEY,
                marca         TEXT    NOT NULL,
                modelo        TEXT    NOT NULL,
                anio          INTEGER NOT NULL,
                tipo          TEXT    NOT NULL,
                precio        REAL    NOT NULL,
                descripcion   TEXT,
                imagen        TEXT,
                creado_en     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                oferta        INTEGER NOT NULL DEFAULT 0,
                precio_oferta REAL,
                moneda        TEXT NOT NULL DEFAULT 'DOP',
                imagenes_extra TEXT
            )
        ''')

        # ── Tabla de configuración (clave/valor) ──
        conn.execute('''
            CREATE TABLE IF NOT EXISTS configuracion (
                clave TEXT PRIMARY KEY,
                valor TEXT NOT NULL
            )
        ''')
        
        # Valores por defecto para el mapa
        conn.execute("INSERT INTO configuracion (clave, valor) VALUES ('mapa_lat', '18.4737') ON CONFLICT (clave) DO NOTHING")
        conn.execute("INSERT INTO configuracion (clave, valor) VALUES ('mapa_lon', '-69.9490') ON CONFLICT (clave) DO NOTHING")
        conn.execute("INSERT INTO configuracion (clave, valor) VALUES ('mapa_label', 'KingsDealer — Av. Abraham Lincoln, Santo Domingo') ON CONFLICT (clave) DO NOTHING")

        # ── Tabla de anuncios de clientes ──
        conn.execute('''
            CREATE TABLE IF NOT EXISTS anuncios_clientes (
                id          SERIAL PRIMARY KEY,
                nombre      TEXT    NOT NULL,
                telefono    TEXT    NOT NULL,
                whatsapp    TEXT,
                marca       TEXT    NOT NULL,
                modelo      TEXT    NOT NULL,
                anio        INTEGER NOT NULL,
                tipo        TEXT    NOT NULL,
                precio      REAL    NOT NULL,
                moneda      TEXT    NOT NULL DEFAULT 'DOP',
                condicion   TEXT    NOT NULL DEFAULT 'usado',
                descripcion TEXT,
                imagen         TEXT,
                imagenes_extra TEXT,
                estado         TEXT    NOT NULL DEFAULT 'pendiente',
                creado_en      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        # Migración: añadir columna si la tabla ya existe sin ella
        try:
            conn.execute('ALTER TABLE anuncios_clientes ADD COLUMN imagenes_extra TEXT')
        except Exception:
            pass


if DATABASE_URL:
    init_db()


# ══════════════════════════════════════════════════════════════════
# HELPERS
# ══════════════════════════════════════════════════════════════════

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def admin_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if session.get('role') != 'admin':
            return jsonify({'error': 'No autorizado'}), 403
        return f(*args, **kwargs)
    return decorated

def sanitize_text(value, max_len=255):
    if not isinstance(value, str): return ''
    return re.sub(r'[<>"\'`;]', '', value).strip()[:max_len]

def sanitize_phone(value):
    if not isinstance(value, str): return ''
    return re.sub(r'[^0-9+\-() ]', '', value).strip()[:20]

def guardar_imagen(file):
    if not file or not file.filename: return None
    if not allowed_file(file.filename): return None
    filename = secure_filename(file.filename)
    unique   = secrets.token_hex(8) + '_' + filename
    file.save(os.path.join(app.config['UPLOAD_FOLDER'], unique))
    return unique

def borrar_imagen(nombre):
    if not nombre: return
    path = os.path.join(app.config['UPLOAD_FOLDER'], nombre)
    if os.path.exists(path): os.remove(path)

def row_to_dict(row):
    d = dict(row)
    raw = d.get('imagenes_extra')
    try:    d['imagenes_extra'] = json.loads(raw) if raw else []
    except: d['imagenes_extra'] = []
    return d

def get_config(clave, default=''):
    with get_db() as conn:
        r = conn.execute("SELECT valor FROM configuracion WHERE clave=? LIMIT 1", (clave,)).fetchone()
    return r['valor'] if r else default


# ══════════════════════════════════════════════════════════════════
# RUTAS PWA
# ══════════════════════════════════════════════════════════════════

@app.route('/static/sw.js')
def service_worker():
    resp = send_from_directory(os.path.join(app.root_path, 'static'), 'sw.js', mimetype='application/javascript')
    resp.headers['Service-Worker-Allowed'] = '/'
    resp.headers['Cache-Control']          = 'no-cache, no-store, must-revalidate'
    return resp

@app.route('/offline.html')
def offline():
    return send_from_directory(app.root_path, 'offline.html')


# ══════════════════════════════════════════════════════════════════
# RUTAS PÚBLICAS
# ══════════════════════════════════════════════════════════════════

@app.route('/')
def index():
    role = session.get('role', 'user')
    try:
        mapa = {
            'lat':   get_config('mapa_lat',   '18.4737'),
            'lon':   get_config('mapa_lon',   '-69.9490'),
            'label': get_config('mapa_label', 'KingsDealer — Av. Abraham Lincoln, Santo Domingo'),
        }
    except Exception:
        # Si la DB no responde, usar valores por defecto y seguir cargando la página
        mapa = {'lat': '18.4737', 'lon': '-69.9490', 'label': 'KingsDealer — Santo Domingo'}
    return render_template('index.html', role=role, mapa=mapa)


@app.route('/vender', methods=['GET'])
def vender():
    return render_template('vender.html')


@app.route('/login', methods=['GET', 'POST'])
def login():
    if session.get('role') == 'admin':
        return redirect(url_for('index'))
    error = None
    if request.method == 'POST':
        username = request.form.get('username', '').strip()
        password = request.form.get('password', '')
        pw_hash  = hashlib.sha256(password.encode()).hexdigest()
        if username == ADMIN_USER and pw_hash == ADMIN_PASS_HASH:
            session.clear()
            session['role']   = 'admin'
            session.permanent = False
            return redirect(url_for('index'))
        error = 'Credenciales incorrectas.'
    return render_template('login.html', error=error)


@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('index'))


# ══════════════════════════════════════════════════════════════════
# API DE VEHÍCULOS
# ══════════════════════════════════════════════════════════════════

@app.route('/api/vehiculos', methods=['GET'])
def api_vehiculos():
    tipo   = request.args.get('tipo', '')
    params = []

    q_dealer = (
        'SELECT id, marca, modelo, anio, tipo, precio, descripcion, imagen, '
        'creado_en, oferta, precio_oferta, moneda, imagenes_extra, '
        'NULL as nombre_vendedor, NULL as telefono_vendedor, '
        'NULL as whatsapp_vendedor, NULL as condicion, \'dealer\' as origen '
        'FROM vehiculos'
    )
    if tipo:
        q_dealer += ' WHERE tipo = ?'
        params.append(tipo)

    q_clientes = (
        'SELECT id, marca, modelo, anio, tipo, precio, descripcion, imagen, '
        'creado_en, 0 as oferta, NULL as precio_oferta, moneda, '
        'imagenes_extra, nombre as nombre_vendedor, '
        'telefono as telefono_vendedor, whatsapp as whatsapp_vendedor, '
        'condicion, \'cliente\' as origen '
        'FROM anuncios_clientes WHERE estado = \'aprobado\''
    )
    if tipo:
        q_clientes += ' AND tipo = ?'
        params.append(tipo)

    full_query = (
        f'SELECT * FROM ({q_dealer} UNION ALL {q_clientes}) AS resultado '
        f'ORDER BY creado_en DESC'
    )

    with get_db() as conn:
        rows = conn.execute(full_query, params).fetchall()

    result = []
    for r in rows:
        d = dict(r)
        raw = d.get('imagenes_extra')
        try:    d['imagenes_extra'] = json.loads(raw) if raw else []
        except: d['imagenes_extra'] = []
        result.append(d)

    return jsonify(result)


@app.route('/api/ofertas', methods=['GET'])
def api_ofertas():
    with get_db() as conn:
        rows = conn.execute('SELECT * FROM vehiculos WHERE oferta = 1 ORDER BY creado_en DESC').fetchall()
    return jsonify([row_to_dict(r) for r in rows])


@app.route('/api/vehiculos', methods=['POST'])
@admin_required
def api_crear_vehiculo():
    marca       = sanitize_text(request.form.get('marca', ''), 100)
    modelo      = sanitize_text(request.form.get('modelo', ''), 100)
    tipo        = sanitize_text(request.form.get('tipo', ''), 50)
    descripcion = sanitize_text(request.form.get('descripcion', ''), 500)
    moneda      = 'USD' if request.form.get('moneda') == 'USD' else 'DOP'
    try:
        anio   = int(request.form.get('anio', 0))
        precio = float(request.form.get('precio', 0))
    except ValueError:
        return jsonify({'error': 'Año o precio inválido.'}), 400
    if not all([marca, modelo, tipo, 1980 <= anio <= 2030, precio > 0]):
        return jsonify({'error': 'Datos incompletos o inválidos.'}), 400

    oferta = 1 if request.form.get('oferta') == '1' else 0
    try:    precio_oferta = float(request.form.get('precio_oferta', '').strip()) or None
    except: precio_oferta = None

    imagen = guardar_imagen(request.files.get('imagen'))
    imagenes_extra = [n for n in [guardar_imagen(f) for f in request.files.getlist('imagenes_extra')] if n]

    with get_db() as conn:
        cur = conn.execute(
            'INSERT INTO vehiculos (marca,modelo,anio,tipo,precio,descripcion,imagen,oferta,precio_oferta,moneda,imagenes_extra) VALUES (?,?,?,?,?,?,?,?,?,?,?) RETURNING id',
            (marca, modelo, anio, tipo, precio, descripcion, imagen, oferta, precio_oferta, moneda, json.dumps(imagenes_extra))
        )
        generated_id = cur.fetchone()['id']
        row = conn.execute('SELECT * FROM vehiculos WHERE id=?', (generated_id,)).fetchone()
    return jsonify(row_to_dict(row)), 201


@app.route('/api/vehiculos/<int:vid>', methods=['PUT'])
@admin_required
def api_editar_vehiculo(vid):
    with get_db() as conn:
        existing = conn.execute('SELECT * FROM vehiculos WHERE id=?', (vid,)).fetchone()
    if not existing:
        return jsonify({'error': 'No encontrado.'}), 404
    ex = row_to_dict(existing)

    marca       = sanitize_text(request.form.get('marca',       ex['marca']),       100)
    modelo      = sanitize_text(request.form.get('modelo',      ex['modelo']),      100)
    tipo        = sanitize_text(request.form.get('tipo',        ex['tipo']),        50)
    descripcion = sanitize_text(request.form.get('descripcion', ex['descripcion'] or ''), 500)
    moneda_raw  = request.form.get('moneda')
    moneda      = 'USD' if moneda_raw == 'USD' else ('DOP' if moneda_raw == 'DOP' else ex.get('moneda', 'DOP'))
    try:
        anio   = int(request.form.get('anio',    ex['anio']))
        precio = float(request.form.get('precio', ex['precio']))
    except ValueError:
        return jsonify({'error': 'Año o precio inválido.'}), 400

    oferta_raw = request.form.get('oferta')
    oferta     = int(oferta_raw) if oferta_raw in ('0','1') else ex['oferta']
    try:    precio_oferta = float(request.form.get('precio_oferta','').strip()) or None
    except: precio_oferta = ex['precio_oferta']

    imagen = ex['imagen']
    nuevo_principal = request.files.get('imagen')
    if nuevo_principal and nuevo_principal.filename:
        borrar_imagen(imagen)
        imagen = guardar_imagen(nuevo_principal)

    try:    keep_list = json.loads(request.form.get('imagenes_extra_keep', '[]'))
    except: keep_list = []
    if not isinstance(keep_list, list): keep_list = []

    for nombre in ex['imagenes_extra']:
        if nombre not in keep_list: borrar_imagen(nombre)

    nuevas_extra   = [n for n in [guardar_imagen(f) for f in request.files.getlist('imagenes_extra')] if n]
    imagenes_extra = keep_list + nuevas_extra

    with get_db() as conn:
        conn.execute(
            'UPDATE vehiculos SET marca=?,modelo=?,anio=?,tipo=?,precio=?,descripcion=?,imagen=?,oferta=?,precio_oferta=?,moneda=?,imagenes_extra=? WHERE id=?',
            (marca, modelo, anio, tipo, precio, descripcion, imagen, oferta, precio_oferta, moneda, json.dumps(imagenes_extra), vid)
        )
        row = conn.execute('SELECT * FROM vehiculos WHERE id=?', (vid,)).fetchone()
    return jsonify(row_to_dict(row))


@app.route('/api/vehiculos/<int:vid>', methods=['DELETE'])
@admin_required
def api_eliminar_vehiculo(vid):
    with get_db() as conn:
        row = conn.execute('SELECT * FROM vehiculos WHERE id=?', (vid,)).fetchone()
        if not row: return jsonify({'error': 'No encontrado.'}), 404
        d = row_to_dict(row)
        borrar_imagen(d['imagen'])
        for n in d['imagenes_extra']: borrar_imagen(n)
        conn.execute('DELETE FROM vehiculos WHERE id=?', (vid,))
    return jsonify({'ok': True})


# ══════════════════════════════════════════════════════════════════
# API CONFIGURACIÓN (mapa)
# ══════════════════════════════════════════════════════════════════

@app.route('/api/config/mapa', methods=['GET'])
def api_get_mapa():
    return jsonify({
        'lat':   get_config('mapa_lat',   '18.4737'),
        'lon':   get_config('mapa_lon',   '-69.9490'),
        'label': get_config('mapa_label', 'KingsDealer — Av. Abraham Lincoln'),
    })


@app.route('/api/config/mapa', methods=['PUT'])
@admin_required
def api_set_mapa():
    data = request.get_json(silent=True) or {}
    lat   = str(data.get('lat',   '')).strip()
    lon   = str(data.get('lon',   '')).strip()
    label = sanitize_text(str(data.get('label', '')), 200)

    try:
        float(lat); float(lon)
    except ValueError:
        return jsonify({'error': 'Coordenadas inválidas.'}), 400

    with get_db() as conn:
        conn.execute("INSERT INTO configuracion (clave,valor) VALUES ('mapa_lat',?) ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor",   (lat,))
        conn.execute("INSERT INTO configuracion (clave,valor) VALUES ('mapa_lon',?) ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor",   (lon,))
        conn.execute("INSERT INTO configuracion (clave,valor) VALUES ('mapa_label',?) ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor", (label,))
    return jsonify({'ok': True, 'lat': lat, 'lon': lon, 'label': label})


# ══════════════════════════════════════════════════════════════════
# API ANUNCIOS DE CLIENTES
# ══════════════════════════════════════════════════════════════════

@app.route('/api/anuncios', methods=['POST'])
def api_crear_anuncio():
    nombre    = sanitize_text(request.form.get('nombre', ''), 100)
    telefono  = sanitize_phone(request.form.get('telefono', ''))
    whatsapp  = sanitize_phone(request.form.get('whatsapp', ''))
    marca     = sanitize_text(request.form.get('marca', ''), 100)
    modelo    = sanitize_text(request.form.get('modelo', ''), 100)
    tipo      = sanitize_text(request.form.get('tipo', ''), 50)
    descripcion = sanitize_text(request.form.get('descripcion', ''), 500)
    moneda    = 'USD' if request.form.get('moneda') == 'USD' else 'DOP'
    condicion = 'nuevo' if request.form.get('condicion') == 'nuevo' else 'usado'

    try:
        anio   = int(request.form.get('anio', 0))
        precio = float(request.form.get('precio', 0))
    except ValueError:
        return jsonify({'error': 'Año o precio inválido.'}), 400

    if not all([nombre, telefono, marca, modelo, tipo, 1980 <= anio <= 2030, precio > 0]):
        return jsonify({'error': 'Completa todos los campos requeridos.'}), 400

    imagen = guardar_imagen(request.files.get('imagen'))
    extras = [n for n in [guardar_imagen(f) for f in request.files.getlist('imagenes_extra')] if n]

    with get_db() as conn:
        cur = conn.execute(
            'INSERT INTO anuncios_clientes (nombre,telefono,whatsapp,marca,modelo,anio,tipo,precio,moneda,condicion,descripcion,imagen,imagenes_extra) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id',
            (nombre, telefono, whatsapp, marca, modelo, anio, tipo, precio, moneda, condicion, descripcion, imagen, json.dumps(extras))
        )
        generated_id = cur.fetchone()['id']
    return jsonify({'ok': True, 'id': generated_id}), 201


@app.route('/api/anuncios', methods=['GET'])
@admin_required
def api_listar_anuncios():
    estado = request.args.get('estado', '')
    query  = 'SELECT * FROM anuncios_clientes'
    params = []
    if estado:
        query += ' WHERE estado = ?'
        params.append(estado)
    query += ' ORDER BY creado_en DESC'
    with get_db() as conn:
        rows = conn.execute(query, params).fetchall()
    return jsonify([dict(r) for r in rows])


@app.route('/api/anuncios/<int:aid>', methods=['PUT'])
@admin_required
def api_actualizar_anuncio(aid):
    data   = request.get_json(silent=True) or {}
    estado = data.get('estado', '')
    if estado not in ('pendiente', 'aprobado', 'rechazado'):
        return jsonify({'error': 'Estado inválido.'}), 400
    with get_db() as conn:
        conn.execute('UPDATE anuncios_clientes SET estado=? WHERE id=?', (estado, aid))
    return jsonify({'ok': True})


@app.route('/api/anuncios/<int:aid>', methods=['DELETE'])
@admin_required
def api_eliminar_anuncio(aid):
    with get_db() as conn:
        row = conn.execute('SELECT imagen FROM anuncios_clientes WHERE id=?', (aid,)).fetchone()
        if not row: return jsonify({'error': 'No encontrado.'}), 404
        borrar_imagen(row['imagen'])
        conn.execute('DELETE FROM anuncios_clientes WHERE id=?', (aid,))
    return jsonify({'ok': True})


# ── Imágenes ──────────────────────────────────────
@app.route('/static/uploads/<path:filename>')
def uploaded_file(filename):
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename)


# ── Manejador global de errores 500 ──────────────
@app.errorhandler(500)
def internal_error(e):
    import traceback
    app.logger.error("Error 500: %s\n%s", str(e), traceback.format_exc())
    return jsonify({'error': 'Error interno del servidor. Intenta de nuevo.'}), 500

@app.errorhandler(413)
def request_too_large(e):
    return jsonify({'error': 'El archivo es demasiado grande. Máx. 8 MB por foto.'}), 413


if __name__ == '__main__':
    app.run(debug=False, port=5000)
