"""
KingsDealer - Flask Backend
Dealer de vehículos en Santo Domingo
"""

import os
import sqlite3
import hashlib
import secrets
import re
from functools import wraps
from flask import (
    Flask, render_template, request, redirect,
    url_for, session, jsonify, send_from_directory
)
from werkzeug.utils import secure_filename

# ── Configuración ──────────────────────────────────────────────
app = Flask(__name__)
app.secret_key = secrets.token_hex(32)

UPLOAD_FOLDER = os.path.join(app.root_path, 'static', 'uploads')
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'webp', 'gif'}
MAX_CONTENT_LENGTH = 8 * 1024 * 1024
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['MAX_CONTENT_LENGTH'] = MAX_CONTENT_LENGTH

DATABASE = os.path.join(app.root_path, 'KingsDealer.db')

ADMIN_USER = 'juan'
ADMIN_PASS_HASH = hashlib.sha256('tuloabe'.encode()).hexdigest()

# ── Base de datos ───────────────────────────────────────────────
def get_db():
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    os.makedirs(UPLOAD_FOLDER, exist_ok=True)
    with get_db() as conn:
        conn.execute('''
            CREATE TABLE IF NOT EXISTS vehiculos (
                id        INTEGER PRIMARY KEY AUTOINCREMENT,
                marca     TEXT NOT NULL,
                modelo    TEXT NOT NULL,
                anio      INTEGER NOT NULL,
                tipo      TEXT NOT NULL,
                precio    REAL NOT NULL,
                descripcion TEXT,
                imagen    TEXT,
                creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        cols = [row[1] for row in conn.execute("PRAGMA table_info(vehiculos)").fetchall()]
        if 'oferta' not in cols:
            conn.execute("ALTER TABLE vehiculos ADD COLUMN oferta INTEGER NOT NULL DEFAULT 0")
        if 'precio_oferta' not in cols:
            conn.execute("ALTER TABLE vehiculos ADD COLUMN precio_oferta REAL")
        conn.commit()


# ── Helpers ─────────────────────────────────────────────────────
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
    if not isinstance(value, str):
        return ''
    return re.sub(r'[<>"\'`;]', '', value).strip()[:max_len]


# ══════════════════════════════════════════════════════════════════
# ── RUTAS PWA ────────────────────────────────────────────────────
# ══════════════════════════════════════════════════════════════════

@app.route('/static/sw.js')
def service_worker():
    """
    Sirve el SW con Service-Worker-Allowed: / para que tenga scope raíz
    aunque el archivo esté en /static/sw.js.
    Cache-Control: no-cache para que el navegador siempre compruebe actualizaciones.
    """
    resp = send_from_directory(
        os.path.join(app.root_path, 'static'), 'sw.js',
        mimetype='application/javascript'
    )
    resp.headers['Service-Worker-Allowed'] = '/'
    resp.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    return resp


@app.route('/offline.html')
def offline():
    return send_from_directory(app.root_path, 'offline.html')


# ── Rutas públicas ──────────────────────────────────────────────
@app.route('/')
def index():
    role = session.get('role', 'user')
    return render_template('index.html', role=role)


@app.route('/login', methods=['GET', 'POST'])
def login():
    if session.get('role') == 'admin':
        return redirect(url_for('index'))

    error = None
    if request.method == 'POST':
        username = request.form.get('username', '').strip()
        password = request.form.get('password', '')
        pw_hash = hashlib.sha256(password.encode()).hexdigest()

        if username == ADMIN_USER and pw_hash == ADMIN_PASS_HASH:
            session.clear()
            session['role'] = 'admin'
            session.permanent = False
            return redirect(url_for('index'))
        else:
            error = 'Credenciales incorrectas.'

    return render_template('login.html', error=error)


@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('index'))


# ── API de vehículos ────────────────────────────────────────────
@app.route('/api/vehiculos', methods=['GET'])
def api_vehiculos():
    tipo = request.args.get('tipo', '')
    query = 'SELECT * FROM vehiculos'
    params = []
    if tipo:
        query += ' WHERE tipo = ?'
        params.append(tipo)
    query += ' ORDER BY creado_en DESC'
    with get_db() as conn:
        rows = conn.execute(query, params).fetchall()
    return jsonify([dict(r) for r in rows])


@app.route('/api/ofertas', methods=['GET'])
def api_ofertas():
    with get_db() as conn:
        rows = conn.execute(
            'SELECT * FROM vehiculos WHERE oferta = 1 ORDER BY creado_en DESC'
        ).fetchall()
    return jsonify([dict(r) for r in rows])


@app.route('/api/vehiculos', methods=['POST'])
@admin_required
def api_crear_vehiculo():
    marca       = sanitize_text(request.form.get('marca', ''), 100)
    modelo      = sanitize_text(request.form.get('modelo', ''), 100)
    tipo        = sanitize_text(request.form.get('tipo', ''), 50)
    descripcion = sanitize_text(request.form.get('descripcion', ''), 500)

    try:
        anio   = int(request.form.get('anio', 0))
        precio = float(request.form.get('precio', 0))
    except ValueError:
        return jsonify({'error': 'Año o precio inválido.'}), 400

    if not all([marca, modelo, tipo, 1980 <= anio <= 2030, precio > 0]):
        return jsonify({'error': 'Datos incompletos o inválidos.'}), 400

    oferta = 1 if request.form.get('oferta') == '1' else 0
    precio_oferta_raw = request.form.get('precio_oferta', '').strip()
    try:
        precio_oferta = float(precio_oferta_raw) if precio_oferta_raw else None
    except ValueError:
        precio_oferta = None

    imagen = None
    file = request.files.get('imagen')
    if file and allowed_file(file.filename):
        filename = secure_filename(file.filename)
        unique   = secrets.token_hex(8) + '_' + filename
        file.save(os.path.join(app.config['UPLOAD_FOLDER'], unique))
        imagen = unique

    with get_db() as conn:
        cur = conn.execute(
            'INSERT INTO vehiculos (marca,modelo,anio,tipo,precio,descripcion,imagen,oferta,precio_oferta) VALUES (?,?,?,?,?,?,?,?,?)',
            (marca, modelo, anio, tipo, precio, descripcion, imagen, oferta, precio_oferta)
        )
        conn.commit()
        vid = cur.lastrowid
        row = conn.execute('SELECT * FROM vehiculos WHERE id=?', (vid,)).fetchone()
    return jsonify(dict(row)), 201


@app.route('/api/vehiculos/<int:vid>', methods=['PUT'])
@admin_required
def api_editar_vehiculo(vid):
    with get_db() as conn:
        existing = conn.execute('SELECT * FROM vehiculos WHERE id=?', (vid,)).fetchone()
    if not existing:
        return jsonify({'error': 'No encontrado.'}), 404

    marca       = sanitize_text(request.form.get('marca', existing['marca']), 100)
    modelo      = sanitize_text(request.form.get('modelo', existing['modelo']), 100)
    tipo        = sanitize_text(request.form.get('tipo', existing['tipo']), 50)
    descripcion = sanitize_text(request.form.get('descripcion', existing['descripcion'] or ''), 500)

    try:
        anio   = int(request.form.get('anio', existing['anio']))
        precio = float(request.form.get('precio', existing['precio']))
    except ValueError:
        return jsonify({'error': 'Año o precio inválido.'}), 400

    oferta_raw = request.form.get('oferta')
    oferta = int(oferta_raw) if oferta_raw in ('0', '1') else existing['oferta']

    precio_oferta_raw = request.form.get('precio_oferta', '').strip()
    try:
        precio_oferta = float(precio_oferta_raw) if precio_oferta_raw else None
    except ValueError:
        precio_oferta = existing['precio_oferta']

    imagen = existing['imagen']
    file = request.files.get('imagen')
    if file and allowed_file(file.filename):
        if imagen:
            old_path = os.path.join(app.config['UPLOAD_FOLDER'], imagen)
            if os.path.exists(old_path):
                os.remove(old_path)
        filename = secure_filename(file.filename)
        unique   = secrets.token_hex(8) + '_' + filename
        file.save(os.path.join(app.config['UPLOAD_FOLDER'], unique))
        imagen = unique

    with get_db() as conn:
        conn.execute(
            'UPDATE vehiculos SET marca=?,modelo=?,anio=?,tipo=?,precio=?,descripcion=?,imagen=?,oferta=?,precio_oferta=? WHERE id=?',
            (marca, modelo, anio, tipo, precio, descripcion, imagen, oferta, precio_oferta, vid)
        )
        conn.commit()
        row = conn.execute('SELECT * FROM vehiculos WHERE id=?', (vid,)).fetchone()
    return jsonify(dict(row))


@app.route('/api/vehiculos/<int:vid>', methods=['DELETE'])
@admin_required
def api_eliminar_vehiculo(vid):
    with get_db() as conn:
        row = conn.execute('SELECT imagen FROM vehiculos WHERE id=?', (vid,)).fetchone()
        if not row:
            return jsonify({'error': 'No encontrado.'}), 404
        if row['imagen']:
            img_path = os.path.join(app.config['UPLOAD_FOLDER'], row['imagen'])
            if os.path.exists(img_path):
                os.remove(img_path)
        conn.execute('DELETE FROM vehiculos WHERE id=?', (vid,))
        conn.commit()
    return jsonify({'ok': True})


@app.route('/static/uploads/<path:filename>')
def uploaded_file(filename):
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename)


# ── Entry point ─────────────────────────────────────────────────
if __name__ == '__main__':
    init_db()
    app.run(debug=True, port=5000)
