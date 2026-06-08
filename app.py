"""
KingsDealer - Flask Backend
Imágenes guardadas en PostgreSQL como base64 (Railway-compatible)
"""

import os, json, base64, hashlib, secrets, re
import psycopg2
from psycopg2.extras import RealDictCursor
from functools import wraps
from flask import (Flask, render_template, request, redirect,
                   url_for, session, jsonify, send_from_directory, Response)
from werkzeug.utils import secure_filename
from dotenv import load_dotenv

load_dotenv()
app = Flask(__name__)

_secret = os.environ.get("SECRET_KEY")
if not _secret:
    raise RuntimeError("SECRET_KEY no definida.")
app.secret_key = _secret

ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'webp', 'gif'}
app.config['MAX_CONTENT_LENGTH'] = 8 * 1024 * 1024 * 20

DATABASE_URL = os.environ.get("DATABASE_URL", "")
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

_admin_user = os.environ.get("ADMIN_USER")
_admin_pass = os.environ.get("ADMIN_PASS")
if not _admin_user or not _admin_pass:
    raise RuntimeError("ADMIN_USER y/o ADMIN_PASS no definidas.")
ADMIN_USER      = _admin_user
ADMIN_PASS_HASH = hashlib.sha256(_admin_pass.encode()).hexdigest()


# ── DB ────────────────────────────────────────────
class PostgresConnection:
    def __init__(self, url):
        self.url = url; self.conn = None; self.cur = None
    def __enter__(self):
        self.conn = psycopg2.connect(self.url, cursor_factory=RealDictCursor)
        self.cur  = self.conn.cursor()
        return self
    def __exit__(self, exc_type, *_):
        if exc_type: self.conn.rollback()
        else:        self.conn.commit()
        self.cur.close(); self.conn.close()
    def execute(self, query, params=None):
        query = query.replace('?', '%s')
        self.cur.execute(query, params or None)
        return self.cur

def get_db():
    return PostgresConnection(DATABASE_URL)

def init_db():
    with get_db() as conn:
        # Tabla de imágenes — base64 en BD, permanente en Railway
        conn.execute('''
            CREATE TABLE IF NOT EXISTS imagenes (
                id        SERIAL PRIMARY KEY,
                nombre    TEXT UNIQUE NOT NULL,
                mime_type TEXT NOT NULL DEFAULT 'image/jpeg',
                data      TEXT NOT NULL,
                creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        # Tabla de vehículos del dealer
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
        # Tabla de configuración
        conn.execute('''
            CREATE TABLE IF NOT EXISTS configuracion (
                clave TEXT PRIMARY KEY,
                valor TEXT NOT NULL
            )
        ''')
        conn.execute("INSERT INTO configuracion (clave,valor) VALUES ('mapa_lat','18.4737') ON CONFLICT DO NOTHING")
        conn.execute("INSERT INTO configuracion (clave,valor) VALUES ('mapa_lon','-69.9490') ON CONFLICT DO NOTHING")
        conn.execute("INSERT INTO configuracion (clave,valor) VALUES ('mapa_label','KingsDealer — Av. Abraham Lincoln, Santo Domingo') ON CONFLICT DO NOTHING")
        # Tabla de anuncios de clientes
        conn.execute('''
            CREATE TABLE IF NOT EXISTS anuncios_clientes (
                id             SERIAL PRIMARY KEY,
                nombre         TEXT    NOT NULL,
                telefono       TEXT    NOT NULL,
                whatsapp       TEXT,
                marca          TEXT    NOT NULL,
                modelo         TEXT    NOT NULL,
                anio           INTEGER NOT NULL,
                tipo           TEXT    NOT NULL,
                precio         REAL    NOT NULL,
                moneda         TEXT    NOT NULL DEFAULT 'DOP',
                condicion      TEXT    NOT NULL DEFAULT 'usado',
                descripcion    TEXT,
                imagen         TEXT,
                imagenes_extra TEXT,
                estado         TEXT    NOT NULL DEFAULT 'pendiente',
                creado_en      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        # Migración: añadir imagenes_extra si BD ya existía sin ella
        conn.execute("""
            DO $$ BEGIN
              IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name='anuncios_clientes' AND column_name='imagenes_extra'
              ) THEN ALTER TABLE anuncios_clientes ADD COLUMN imagenes_extra TEXT;
              END IF;
            END $$;
        """)

if DATABASE_URL:
    init_db()


# ── Helpers ───────────────────────────────────────
def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def admin_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if session.get('role') != 'admin':
            return jsonify({'error': 'No autorizado'}), 403
        return f(*args, **kwargs)
    return decorated

def sanitize_text(v, n=255):
    if not isinstance(v, str): return ''
    return re.sub(r'[<>"\';`]', '', v).strip()[:n]

def sanitize_phone(v):
    if not isinstance(v, str): return ''
    return re.sub(r'[^0-9+\-() ]', '', v).strip()[:20]

def guardar_imagen(file):
    """Guarda imagen en PostgreSQL como base64. Devuelve nombre único."""
    if not file or not file.filename: return None
    if not allowed_file(file.filename): return None
    ext  = file.filename.rsplit('.', 1)[1].lower()
    nombre = secrets.token_hex(16) + '.' + ext
    mime   = {'jpg':'image/jpeg','jpeg':'image/jpeg','png':'image/png',
               'webp':'image/webp','gif':'image/gif'}.get(ext, 'image/jpeg')
    data   = base64.b64encode(file.read()).decode('utf-8')
    with get_db() as conn:
        conn.execute(
            'INSERT INTO imagenes (nombre,mime_type,data) VALUES (?,?,?) ON CONFLICT (nombre) DO NOTHING',
            (nombre, mime, data)
        )
    return nombre

def borrar_imagen(nombre):
    if not nombre: return
    with get_db() as conn:
        conn.execute('DELETE FROM imagenes WHERE nombre=?', (nombre,))

def row_to_dict(row):
    d = dict(row)
    raw = d.get('imagenes_extra')
    try:    d['imagenes_extra'] = json.loads(raw) if raw else []
    except: d['imagenes_extra'] = []
    return d

def get_config(clave, default=''):
    with get_db() as conn:
        r = conn.execute('SELECT valor FROM configuracion WHERE clave=? LIMIT 1', (clave,)).fetchone()
    return r['valor'] if r else default


# ── Servir imágenes desde BD ──────────────────────
@app.route('/img/<nombre>')
def serve_imagen(nombre):
    with get_db() as conn:
        row = conn.execute('SELECT mime_type, data FROM imagenes WHERE nombre=?', (nombre,)).fetchone()
    if not row: return '', 404
    return Response(base64.b64decode(row['data']), mimetype=row['mime_type'],
                    headers={'Cache-Control': 'public, max-age=31536000'})


# ── PWA ───────────────────────────────────────────
@app.route('/static/sw.js')
def service_worker():
    resp = send_from_directory(os.path.join(app.root_path, 'static'), 'sw.js',
                               mimetype='application/javascript')
    resp.headers['Service-Worker-Allowed'] = '/'
    resp.headers['Cache-Control']          = 'no-cache, no-store, must-revalidate'
    return resp

@app.route('/offline.html')
def offline():
    return send_from_directory(app.root_path, 'offline.html')


# ── Rutas públicas ────────────────────────────────
@app.route('/')
def index():
    role = session.get('role', 'user')
    try:
        mapa = {'lat':   get_config('mapa_lat',   '18.4737'),
                'lon':   get_config('mapa_lon',   '-69.9490'),
                'label': get_config('mapa_label', 'KingsDealer — Av. Abraham Lincoln, Santo Domingo')}
    except Exception:
        mapa = {'lat': '18.4737', 'lon': '-69.9490', 'label': 'KingsDealer — Santo Domingo'}
    return render_template('index.html', role=role, mapa=mapa)

@app.route('/vender')
def vender():
    return render_template('vender.html')

@app.route('/login', methods=['GET', 'POST'])
def login():
    if session.get('role') == 'admin':
        return redirect(url_for('index'))
    error = None
    if request.method == 'POST':
        username = request.form.get('username', '').strip()
        pw_hash  = hashlib.sha256(request.form.get('password', '').encode()).hexdigest()
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


# ── API Vehículos (solo dealer) ───────────────────
@app.route('/api/vehiculos', methods=['GET'])
def api_vehiculos():
    tipo   = request.args.get('tipo', '')
    params = []
    query  = ('SELECT id,marca,modelo,anio,tipo,precio,descripcion,imagen,'
              'creado_en,oferta,precio_oferta,moneda,imagenes_extra,'
              "NULL AS nombre_vendedor,NULL AS telefono_vendedor,"
              "NULL AS whatsapp_vendedor,NULL AS condicion,'dealer' AS origen "
              'FROM vehiculos')
    if tipo:
        query += ' WHERE tipo=?'
        params.append(tipo)
    query += ' ORDER BY creado_en DESC'
    with get_db() as conn:
        rows = conn.execute(query, params).fetchall()
    return jsonify([row_to_dict(r) for r in rows])


# ── API Particulares (solo clientes aprobados) ────
@app.route('/api/particulares', methods=['GET'])
def api_particulares():
    with get_db() as conn:
        rows = conn.execute(
            'SELECT id,marca,modelo,anio,tipo,precio,descripcion,imagen,'
            'imagenes_extra,moneda,condicion,creado_en,'
            'nombre AS nombre_vendedor,telefono AS telefono_vendedor,'
            'whatsapp AS whatsapp_vendedor '
            'FROM anuncios_clientes WHERE estado=? ORDER BY creado_en DESC',
            ('aprobado',)
        ).fetchall()
    result = []
    for r in rows:
        d = row_to_dict(r)
        d['origen'] = 'cliente'; d['oferta'] = 0; d['precio_oferta'] = None
        result.append(d)
    return jsonify(result)


# ── API Contadores ────────────────────────────────
@app.route('/api/count')
def api_count():
    with get_db() as conn:
        dealer = conn.execute('SELECT COUNT(*) AS n FROM vehiculos').fetchone()['n']
        part   = conn.execute("SELECT COUNT(*) AS n FROM anuncios_clientes WHERE estado='aprobado'").fetchone()['n']
    return jsonify({'dealer': dealer, 'particulares': part})


# ── API Ofertas ───────────────────────────────────
@app.route('/api/ofertas', methods=['GET'])
def api_ofertas():
    with get_db() as conn:
        rows = conn.execute('SELECT * FROM vehiculos WHERE oferta=1 ORDER BY creado_en DESC').fetchall()
    return jsonify([row_to_dict(r) for r in rows])


# ── CRUD Vehículos ────────────────────────────────
@app.route('/api/vehiculos', methods=['POST'])
@admin_required
def api_crear_vehiculo():
    marca       = sanitize_text(request.form.get('marca',''), 100)
    modelo      = sanitize_text(request.form.get('modelo',''), 100)
    tipo        = sanitize_text(request.form.get('tipo',''), 50)
    descripcion = sanitize_text(request.form.get('descripcion',''), 500)
    moneda      = 'USD' if request.form.get('moneda') == 'USD' else 'DOP'
    try:
        anio   = int(request.form.get('anio', 0))
        precio = float(request.form.get('precio', 0))
    except ValueError:
        return jsonify({'error': 'Año o precio inválido.'}), 400
    if not all([marca, modelo, tipo, 1980 <= anio <= 2030, precio > 0]):
        return jsonify({'error': 'Datos incompletos o inválidos.'}), 400
    oferta = 1 if request.form.get('oferta') == '1' else 0
    try:    precio_oferta = float(request.form.get('precio_oferta','').strip()) or None
    except: precio_oferta = None
    imagen         = guardar_imagen(request.files.get('imagen'))
    imagenes_extra = [n for n in [guardar_imagen(f) for f in request.files.getlist('imagenes_extra')] if n]
    with get_db() as conn:
        cur = conn.execute(
            'INSERT INTO vehiculos (marca,modelo,anio,tipo,precio,descripcion,imagen,'
            'oferta,precio_oferta,moneda,imagenes_extra) VALUES (?,?,?,?,?,?,?,?,?,?,?) RETURNING id',
            (marca,modelo,anio,tipo,precio,descripcion,imagen,oferta,precio_oferta,moneda,json.dumps(imagenes_extra))
        )
        generated_id = cur.fetchone()['id']
        row = conn.execute('SELECT * FROM vehiculos WHERE id=?', (generated_id,)).fetchone()
    return jsonify(row_to_dict(row)), 201


@app.route('/api/vehiculos/<int:vid>', methods=['PUT'])
@admin_required
def api_editar_vehiculo(vid):
    with get_db() as conn:
        existing = conn.execute('SELECT * FROM vehiculos WHERE id=?', (vid,)).fetchone()
    if not existing: return jsonify({'error': 'No encontrado.'}), 404
    ex = row_to_dict(existing)
    marca       = sanitize_text(request.form.get('marca',       ex['marca']),       100)
    modelo      = sanitize_text(request.form.get('modelo',      ex['modelo']),      100)
    tipo        = sanitize_text(request.form.get('tipo',        ex['tipo']),        50)
    descripcion = sanitize_text(request.form.get('descripcion', ex['descripcion'] or ''), 500)
    moneda_raw  = request.form.get('moneda')
    moneda      = 'USD' if moneda_raw == 'USD' else ('DOP' if moneda_raw == 'DOP' else ex.get('moneda','DOP'))
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
    nuevo  = request.files.get('imagen')
    if nuevo and nuevo.filename:
        borrar_imagen(imagen)
        imagen = guardar_imagen(nuevo)
    try:    keep_list = json.loads(request.form.get('imagenes_extra_keep','[]'))
    except: keep_list = []
    if not isinstance(keep_list, list): keep_list = []
    for n in ex['imagenes_extra']:
        if n not in keep_list: borrar_imagen(n)
    nuevas         = [n for n in [guardar_imagen(f) for f in request.files.getlist('imagenes_extra')] if n]
    imagenes_extra = keep_list + nuevas
    with get_db() as conn:
        conn.execute(
            'UPDATE vehiculos SET marca=?,modelo=?,anio=?,tipo=?,precio=?,descripcion=?,imagen=?,'
            'oferta=?,precio_oferta=?,moneda=?,imagenes_extra=? WHERE id=?',
            (marca,modelo,anio,tipo,precio,descripcion,imagen,oferta,precio_oferta,moneda,json.dumps(imagenes_extra),vid)
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


# ── API Configuración mapa ────────────────────────
@app.route('/api/config/mapa', methods=['GET'])
def api_get_mapa():
    return jsonify({'lat':   get_config('mapa_lat',   '18.4737'),
                    'lon':   get_config('mapa_lon',   '-69.9490'),
                    'label': get_config('mapa_label', 'KingsDealer')})

@app.route('/api/config/mapa', methods=['PUT'])
@admin_required
def api_set_mapa():
    data  = request.get_json(silent=True) or {}
    lat   = str(data.get('lat','')).strip()
    lon   = str(data.get('lon','')).strip()
    label = sanitize_text(str(data.get('label','')), 200)
    try: float(lat); float(lon)
    except ValueError: return jsonify({'error': 'Coordenadas inválidas.'}), 400
    with get_db() as conn:
        conn.execute("INSERT INTO configuracion (clave,valor) VALUES ('mapa_lat',?) ON CONFLICT (clave) DO UPDATE SET valor=EXCLUDED.valor",   (lat,))
        conn.execute("INSERT INTO configuracion (clave,valor) VALUES ('mapa_lon',?) ON CONFLICT (clave) DO UPDATE SET valor=EXCLUDED.valor",   (lon,))
        conn.execute("INSERT INTO configuracion (clave,valor) VALUES ('mapa_label',?) ON CONFLICT (clave) DO UPDATE SET valor=EXCLUDED.valor", (label,))
    return jsonify({'ok': True, 'lat': lat, 'lon': lon, 'label': label})


# ── API Anuncios de clientes ──────────────────────
@app.route('/api/anuncios', methods=['POST'])
def api_crear_anuncio():
    nombre      = sanitize_text(request.form.get('nombre',''), 100)
    telefono    = sanitize_phone(request.form.get('telefono',''))
    whatsapp    = sanitize_phone(request.form.get('whatsapp',''))
    marca       = sanitize_text(request.form.get('marca',''), 100)
    modelo      = sanitize_text(request.form.get('modelo',''), 100)
    tipo        = sanitize_text(request.form.get('tipo',''), 50)
    descripcion = sanitize_text(request.form.get('descripcion',''), 500)
    moneda      = 'USD' if request.form.get('moneda') == 'USD' else 'DOP'
    condicion   = 'nuevo' if request.form.get('condicion') == 'nuevo' else 'usado'
    try:
        anio   = int(request.form.get('anio', 0))
        precio = float(request.form.get('precio', 0))
    except ValueError:
        return jsonify({'error': 'Año o precio inválido.'}), 400
    if not all([nombre, telefono, marca, modelo, tipo, 1980 <= anio <= 2030, precio > 0]):
        return jsonify({'error': 'Completa todos los campos requeridos.'}), 400
    imagen  = guardar_imagen(request.files.get('imagen'))
    extras  = [n for n in [guardar_imagen(f) for f in request.files.getlist('imagenes_extra')] if n]
    with get_db() as conn:
        cur = conn.execute(
            'INSERT INTO anuncios_clientes (nombre,telefono,whatsapp,marca,modelo,anio,tipo,'
            'precio,moneda,condicion,descripcion,imagen,imagenes_extra) '
            'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id',
            (nombre,telefono,whatsapp,marca,modelo,anio,tipo,precio,moneda,condicion,descripcion,imagen,json.dumps(extras))
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
        query += ' WHERE estado=?'
        params.append(estado)
    query += ' ORDER BY creado_en DESC'
    with get_db() as conn:
        rows = conn.execute(query, params).fetchall()
    return jsonify([row_to_dict(r) for r in rows])


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
        row = conn.execute('SELECT imagen,imagenes_extra FROM anuncios_clientes WHERE id=?', (aid,)).fetchone()
        if not row: return jsonify({'error': 'No encontrado.'}), 404
        d = row_to_dict(row)
        borrar_imagen(d['imagen'])
        for n in d['imagenes_extra']: borrar_imagen(n)
        conn.execute('DELETE FROM anuncios_clientes WHERE id=?', (aid,))
    return jsonify({'ok': True})


# ── Errores ───────────────────────────────────────
@app.errorhandler(500)
def internal_error(e):
    import traceback
    app.logger.error("500: %s\n%s", str(e), traceback.format_exc())
    return jsonify({'error': 'Error interno del servidor.'}), 500

@app.errorhandler(413)
def too_large(e):
    return jsonify({'error': 'Archivo demasiado grande. Máx. 8 MB por foto.'}), 413


if __name__ == '__main__':
    app.run(debug=False, port=5000)
