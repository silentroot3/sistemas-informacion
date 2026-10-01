const express = require('express');
const session = require('express-session');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const path = require('path');
const KnexSessionStore = require('connect-session-knex')(session);
const knex = require('knex');

const app = express();
const port = 3000;

// ==================== CONFIG DB ====================
const dbConfig = {
  host: process.env.DB_HOST || 'db',
  user: process.env.DB_USER || 'silentroot',
  password: process.env.DB_PASSWORD || '5252',
  database: process.env.DB_NAME || 'info',
  port: Number(process.env.DB_PORT) || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
};

const pool = mysql.createPool(dbConfig);

// Knex para el store de sesiones (misma DB)
const knexInstance = knex({
  client: 'mysql2',
  connection: {
    host: dbConfig.host,
    user: dbConfig.user,
    password: dbConfig.password,
    database: dbConfig.database,
    port: dbConfig.port
  }
});

// ==================== MIDDLEWARES ====================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Store persistente en MariaDB

const sessionStore = new KnexSessionStore({
  knex: knexInstance,
  tablename: 'sessions',
  createtable: true,
  clearInterval: 1000 * 60 * 15 // limpia expiradas cada 15 min
});


app.use(session({
  store: sessionStore,
  secret: process.env.SESSION_SECRET || 'dev_secret_cambiar',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 30 * 60 * 1000, //  30 min de inactividad
    httpOnly: true
  }
}));

// ==================== HELPERS ====================
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ success: false, message: 'No autenticado' });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ success: false, message: 'No autenticado' });
  }
  if (!req.session.user.is_admin) {
    return res.status(403).json({ success: false, message: 'Acceso denegado: solo admin' });
  }
  next();
}

// ==================== INIT DB ====================
async function initDB(retries = 10) {
  for (let i = 0; i < retries; i++) {
    try {
      const conn = await pool.getConnection();

      await conn.execute(`
        CREATE TABLE IF NOT EXISTS usuarios (
          id INT AUTO_INCREMENT PRIMARY KEY,
          nombre VARCHAR(100) NOT NULL,
          email VARCHAR(100) UNIQUE NOT NULL,
          password VARCHAR(255) NOT NULL,
          is_admin TINYINT(1) NOT NULL DEFAULT 0,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      try {
        await conn.execute(`ALTER TABLE usuarios ADD COLUMN is_admin TINYINT(1) NOT NULL DEFAULT 0`);
        console.log(' Columna is_admin agregada');
      } catch (_) {}

      const [rows] = await conn.execute('SELECT COUNT(*) AS count FROM usuarios');
      if (rows[0].count === 0) {
        const hashed = await bcrypt.hash('123456', 10);
        await conn.execute(
          'INSERT INTO usuarios (nombre, email, password, is_admin) VALUES (?, ?, ?, 1)',
          ['Admin', 'admin@test.com', hashed]
        );
        console.log('Admin creado: admin@test.com / 123456');
      }

      conn.release();
      console.log('Base de datos lista');
      return;
    } catch (error) {
      console.error(`DB no lista (${i + 1}/${retries}):`, error.message);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  console.error(' No se pudo inicializar la DB');
}

initDB();

// ==================== RUTAS API ====================

// 1. REGISTRO
app.post('/register', async (req, res) => {
  const { nombre, email, password } = req.body;
  if (!nombre || !email || !password) return res.json({ success: false, message: 'Faltan datos' });
  if (!emailRegex.test(email)) return res.json({ success: false, message: 'Email inválido' });
  if (password.length < 6) return res.json({ success: false, message: 'Contraseña mínima 6 caracteres' });

  try {
    const [existing] = await pool.execute('SELECT id FROM usuarios WHERE email = ?', [email]);
    if (existing.length > 0) return res.json({ success: false, message: 'Email ya registrado' });

    const hashed = await bcrypt.hash(password, 10);
    await pool.execute(
      'INSERT INTO usuarios (nombre, email, password, is_admin) VALUES (?, ?, ?, 0)',
      [nombre, email, hashed]
    );

    res.json({ success: true, message: 'Usuario registrado' });
  } catch (error) {
    console.error('Error /register:', error);
    res.status(500).json({ success: false, message: 'Error en el servidor' });
  }
});
// 2. LOGIN
app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.json({ success: false, message: 'Email y password requeridos' });

  try {
    const [users] = await pool.execute(
      'SELECT id, nombre, email, password, is_admin FROM usuarios WHERE email = ?',
      [email]
    );

    if (users.length === 0) return res.json({ success: false, message: 'Usuario no encontrado' });

    const user = users[0];
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.json({ success: false, message: 'Contraseña incorrecta' });

    // Guardar datos en sesión
    req.session.user = {
      id: user.id,
      nombre: user.nombre,
      email: user.email,
      is_admin: user.is_admin === 1
    };
    req.session.loginAt = new Date().toISOString();
    req.session.ip = req.ip;
    req.session.userAgent = req.headers['user-agent'];

    // 🔑 FORZAR guardado en el store ANTES de responder
    req.session.save((err) => {
      if (err) {
        console.error('Error guardando sesión:', err);
        return res.status(500).json({ success: false, message: 'Error al guardar sesión' });
      }
      console.log('Sesión guardada en DB:', req.sessionID);
      res.json({ success: true, message: 'Login exitoso', user: req.session.user });
    });

  } catch (error) {
    console.error('Error /login:', error);
    res.status(500).json({ success: false, message: 'Error en el servidor' });
  }
});





// 3. VERIFICAR SESIÓN
app.get('/profile', requireAuth, (req, res) => {
  res.json({ success: true, user: req.session.user });
});

// 4. LOGOUT
app.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) return res.status(500).json({ success: false, message: 'Error al cerrar sesión' });
    res.clearCookie('connect.sid', { path: '/' });
    res.json({ success: true, message: 'Sesión cerrada' });
  });
});

// 5. INFO API
app.get('/api', (req, res) => {
  res.json({
    message: 'API de Login Simple',
    rutas: {
      'POST /register': 'Registrar usuario',
      'POST /login': 'Iniciar sesión',
      'GET /profile': 'Ver perfil',
      'POST /logout': 'Cerrar sesión',
      'GET /users': 'Listar usuarios (admin)',
      'PUT /users/:id': 'Actualizar usuario (admin)',
      'DELETE /users/:id': 'Eliminar usuario (admin)',
      'PUT /users/:id/admin': 'Cambiar rol admin (admin)',
      'GET /sessions': 'Ver sesiones activas (admin)',
      'DELETE /sessions/:sid': 'Cerrar una sesión (admin)',
      'DELETE /users/:id/sessions': 'Cerrar todas las sesiones de un usuario (admin)'
    }
  });
});

// ==================== RUTAS SOLO ADMIN ====================

// 6. LISTAR USUARIOS
app.get('/users', requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT id, nombre, email, is_admin, created_at FROM usuarios'
    );
    res.json({ success: true, users: rows });
  } catch (error) {
    console.error('Error /users:', error);
    res.status(500).json({ success: false, message: 'Error' });
  }
});

// 7. ACTUALIZAR USUARIO
app.put('/users/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { nombre, email } = req.body;
  if (!nombre || !email) return res.json({ success: false, message: 'Faltan datos' });
  if (!emailRegex.test(email)) return res.json({ success: false, message: 'Email inválido' });

  try {
    const [existing] = await pool.execute(
      'SELECT id FROM usuarios WHERE email = ? AND id != ?',
      [email, id]
    );
    if (existing.length > 0) return res.json({ success: false, message: 'Email ya en uso' });

    const [result] = await pool.execute(
      'UPDATE usuarios SET nombre = ?, email = ? WHERE id = ?',
      [nombre, email, id]
    );
    if (result.affectedRows === 0) return res.json({ success: false, message: 'Usuario no encontrado' });

    res.json({ success: true, message: 'Usuario actualizado' });
  } catch (error) {
    console.error('Error PUT /users/:id:', error);
    res.status(500).json({ success: false, message: 'Error en el servidor' });
  }
});

// 8. ELIMINAR USUARIO (y sus sesiones)
app.delete('/users/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  if (Number(id) === req.session.user.id) {
    return res.json({ success: false, message: 'No puedes eliminarte a ti mismo' });
  }

  try {
    // Borrar sesiones del usuario antes de borrarlo
    await knexInstance('sessions').where('sess', 'like', `%"id":${id},%`).del();

    const [result] = await pool.execute('DELETE FROM usuarios WHERE id = ?', [id]);
    if (result.affectedRows === 0) return res.json({ success: false, message: 'Usuario no encontrado' });

    res.json({ success: true, message: 'Usuario eliminado' });
  } catch (error) {
    console.error('Error DELETE /users/:id:', error);
    res.status(500).json({ success: false, message: 'Error en el servidor' });
  }
});

// 9. CAMBIAR ROL ADMIN
app.put('/users/:id/admin', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { is_admin } = req.body;
  if (Number(id) === req.session.user.id) {
    return res.json({ success: false, message: 'No puedes cambiar tu propio rol' });
  }

  try {
    const [result] = await pool.execute(
      'UPDATE usuarios SET is_admin = ? WHERE id = ?',
      [is_admin ? 1 : 0, id]
    );
    if (result.affectedRows === 0) return res.json({ success: false, message: 'Usuario no encontrado' });
    res.json({ success: true, message: is_admin ? 'Usuario ahora es admin' : 'Admin removido' });
  } catch (error) {
    console.error('Error PUT /users/:id/admin:', error);
    res.status(500).json({ success: false, message: 'Error en el servidor' });
  }
});

// ==================== GESTIÓN DE SESIONES (ADMIN) ====================

// 10. LISTAR SESIONES ACTIVAS
// 10. LISTAR SESIONES ACTIVAS
app.get('/sessions', requireAdmin, async (req, res) => {
  try {
    const rows = await knexInstance('sessions')
      .select('sid', 'sess', 'expired')
      .orderBy('expired', 'desc');

    const sessions = rows.map(r => {
      let data = {};
      try {
        // Si ya es un objeto, lo usamos tal cual; si es string, lo parseamos
        data = typeof r.sess === 'string' ? JSON.parse(r.sess) : (r.sess || {});
      } catch (err) {
        console.error('Error parseando sesión:', err);
      }
      return {
        sid: r.sid,
        user: data.user || null,
        loginAt: data.loginAt || null,
        ip: data.ip || null,
        userAgent: data.userAgent || null,
        expired: r.expired
      };
    }).filter(s => s.user); // solo sesiones con usuario logueado

    res.json({ success: true, sessions });
  } catch (error) {
    console.error('Error /sessions:', error);
    res.status(500).json({ success: false, message: 'Error al obtener sesiones' });
  }
});

// 11. CERRAR UNA SESIÓN ESPECÍFICA
app.delete('/sessions/:sid', requireAdmin, async (req, res) => {
  const { sid } = req.params;
  try {
    const deleted = await knexInstance('sessions').where('sid', sid).del();
    if (deleted === 0) return res.json({ success: false, message: 'Sesión no encontrada' });
    res.json({ success: true, message: 'Sesión cerrada' });
  } catch (error) {
    console.error('Error DELETE /sessions/:sid:', error);
    res.status(500).json({ success: false, message: 'Error' });
  }
});

// 12. CERRAR TODAS LAS SESIONES DE UN USUARIO
app.delete('/users/:id/sessions', requireAdmin, async (req, res) => {
  const { id } = req.params;
  if (Number(id) === req.session.user.id) {
    return res.json({ success: false, message: 'No puedes cerrar tus propias sesiones desde aquí' });
  }

  try {
    const deleted = await knexInstance('sessions')
      .where('sess', 'like', `%"id":${id},%`)
      .del();
    res.json({ success: true, message: `${deleted} sesión(es) cerrada(s)` });
  } catch (error) {
    console.error('Error DELETE /users/:id/sessions:', error);
    res.status(500).json({ success: false, message: 'Error' });
  }
});

// ==================== INICIO ====================
app.listen(port, '0.0.0.0', () => {
  console.log(`Servidor en http://localhost:${port}`);
  console.log(`Admin: admin@test.com / 123456`);
});
