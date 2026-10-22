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

// Evitar que el servidor se caiga si la DB no responde

const pool = mysql.createPool(dbConfig);
	pool.on('error', (err) => {
     console.error('Error en el pool de MySQL (reintentando):', err.code);
});




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

const sessionStore = new KnexSessionStore({
  knex: knexInstance,
  tablename: 'sessions',
  createtable: true,
  clearInterval: 1000 * 60 * 15
});

app.use(session({
  store: sessionStore,
  secret: process.env.SESSION_SECRET || 'dev_secret_cambiar',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 30 * 60 * 1000,
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
      } catch (_) {}

      const [rows] = await conn.execute('SELECT COUNT(*) AS count FROM usuarios');
      if (rows[0].count === 0) {
        const hashed = await bcrypt.hash('123456', 10);
        await conn.execute(
          'INSERT INTO usuarios (nombre, email, password, is_admin) VALUES (?, ?, ?, 1)',
          ['Admin', 'admin@test.com', hashed]
        );
        console.log('Admin creado por defecto: admin@test.com / 123456');
      }

      conn.release();
      console.log('Base de datos lista');
      return;
    } catch (error) {
      console.error(`DB no lista (${i + 1}/${retries}):`, error.message);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  console.error('No se pudo inicializar la DB');
}

initDB();


// ==================== RUTAS DE AUTENTICACIÓN ====================
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
    res.status(500).json({ success: false, message: 'Error en el servidor' });
  }
});

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

    req.session.user = {
      id: user.id,
      nombre: user.nombre,
      email: user.email,
      is_admin: user.is_admin === 1
    };
    req.session.loginAt = new Date().toISOString();
    req.session.ip = req.ip;
    req.session.userAgent = req.headers['user-agent'];

    req.session.save((err) => {
      if (err) return res.status(500).json({ success: false, message: 'Error al guardar sesión' });
      res.json({ success: true, message: 'Login exitoso', user: req.session.user });
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error en el servidor' });
  }
});

app.get('/profile', requireAuth, (req, res) => {
  res.json({ success: true, user: req.session.user });
});

app.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) return res.status(500).json({ success: false, message: 'Error al cerrar sesión' });
    res.clearCookie('connect.sid', { path: '/' });
    res.json({ success: true, message: 'Sesión cerrada' });
  });
});





// ==================== CATALOGOS PARA EL POS ====================
// En Base a los SELECT's  HACE LAS PETICIONES A LA BASE DE DATOS Y LOS VISUALIZAMOS EN LA PAGINA CON EL FRONTEND dashboar.html

app.get('/salones', requireAuth, async (req, res) => {
  const [rows] = await pool.execute('SELECT * FROM salones WHERE activo = 1');
  res.json({ success: true, salones: rows });
});

app.get('/inflables', requireAuth, async (req, res) => {
  const [rows] = await pool.execute('SELECT * FROM inflables WHERE activo = 1');
  res.json({ success: true, inflables: rows });
});

app.get('/platillos', requireAuth, async (req, res) => {
  try {
    const [platillos] = await pool.execute('SELECT * FROM platillos WHERE activo = 1');
    const catalogo = [];
    for (const p of platillos) {
      const [variantes] = await pool.execute('SELECT * FROM platillo_variantes WHERE platillo_id = ?', [p.id]);
      catalogo.push({ id: p.id, nombre: p.nombre, categoria: p.categoria, variantes });
    }
    res.json({ success: true, catalogo });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Error al cargar catálogo' });
  }
});

app.get('/ingredientes', requireAuth, async (req, res) => {
  const [rows] = await pool.execute('SELECT * FROM ingredientes WHERE activo = 1 ORDER BY categoria, nombre');
  res.json({ success: true, ingredientes: rows });
});



// PERSONALIZACION DE UNA HAMBUERGUESA 
app.get('/platillos/:id/variantes', requireAuth, async (req, res) => {
  const { id } = req.params;
  try {
    const [variantes] = await pool.execute('SELECT * FROM platillo_variantes WHERE platillo_id = ?', [id]);
    for (const v of variantes) {
      const [ings] = await pool.execute(
        `SELECT i.*, vi.incluido_default
         FROM variante_ingredientes vi
         JOIN ingredientes i ON i.id = vi.ingrediente_id
         WHERE vi.variante_id = ?`, [v.id]
      );
      v.ingredientes_default = ings;
    }
    res.json({ success: true, variantes });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Error' });
  }
});











// ==================== GESTIÓN DE RESERVACIONES ====================
app.get('/api/reservaciones', requireAdmin, async (req, res) => {
  try {

	// Hace un JOIN entre la tabla 'reservaciones' y 'salones' para traer el nombre del salon
	
    const [rows] = await pool.execute(`
      SELECT r.*, s.nombre AS salon_nombre 
      FROM reservaciones r
      JOIN salones s ON r.salon_id = s.id
      ORDER BY r.fecha DESC, r.hora_inicio DESC
    `);
    res.json({ success: true, reservaciones: rows });
  } catch (error) {
    console.error('Error /api/reservaciones:', error);
    res.status(500).json({ success: false, message: 'Error al obtener reservaciones' });
  }
});


//Ruta para Crear una nueva reservacion dede el POS del html
app.post('/reservaciones', requireAdmin, async (req, res) => {
  //Extrae todos los datos que envio el frontend 
  
  const { cliente_nombre, cliente_telefono, cliente_email, salon_id, fecha, hora_inicio, hora_fin, num_personas, notas, inflables, platillos } = req.body;

  //Obtiene una conexion exclusiva para hacer la transaccion
  const conn = await pool.getConnection();
  try {
  
    // Inicia la transaccion 
    await conn.beginTransaction();

    //Busca los datos del salon(precio,capacidad, y limite de inflables)
    const [[salon]] = await conn.execute('SELECT * FROM salones WHERE id = ?', [salon_id]);
    if (!salon) throw new Error('Salón no encontrado');

	//El total de las reservaciones inicia con el costo base de salon
    let total = Number(salon.precio_base);

	//Guarda la reservacion
	
    const [resResult] = await conn.execute(
      `INSERT INTO reservaciones (cliente_nombre, cliente_telefono, cliente_email, salon_id, fecha, hora_inicio, hora_fin, num_personas, estado, notas, total, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pendiente', ?, 0, ?)`,
      [cliente_nombre, cliente_telefono || null, cliente_email || null, salon_id, fecha, hora_inicio, hora_fin, num_personas, notas || null, req.session.user.id]
    );

	//Guarda el ID de de la reservacion para ligar los inflables y platillos.
    const reservacion_id = resResult.insertId;



    //Bloqueo de inflables
    if (inflables && Array.isArray(inflables)) {

      // REGLA DE NEGOCIO 1: valida que no se pasen del limite de inflables del salon
      if (inflables.length > salon.max_inflables) {
        throw new Error(`El salón ${salon.nombre} solo permite un máximo de ${salon.max_inflables} inflable(s).`);
      }

      // Validación de capacidad máxima de personas
      if (num_personas > salon.capacidad) {
        throw new Error(`El salón ${salon.nombre} tiene una capacidad máxima de ${salon.capacidad} personas.`);
      }

	  //Recorre cada inflable seleccionado
      for (const inf of inflables) {
        //BUsca el precio real del inflable en la DB
        const [[infData]] = await conn.execute('SELECT * FROM inflables WHERE id = ?', [inf.inflable_id]);
        

      	if (infData) {
        //Suma el precio del inflable al total
          const subtotal = Number(infData.precio) * (inf.cantidad || 1);
          total += subtotal;
          
		  //Guarda el inflable en la tabla de relacion
          await conn.execute(
            `INSERT INTO reservacion_inflables (reservacion_id, inflable_id, cantidad, precio_unitario) VALUES (?, ?, ?, ?)`,
            [reservacion_id, inf.inflable_id, inf.cantidad || 1, infData.precio]
          );
        }
      }
    }

	//BLOQUE DE PLATILLOS
    if (platillos && Array.isArray(platillos)) {
	  //Recorre cada producto (Pizza, hambuerguesa,etc) que el cajero metio al carrito
	  
      for (const pl of platillos) {
		//Busca los datos de la variantes como Pizza mediana
        const [[var_]] = await conn.execute('SELECT * FROM platillo_variantes WHERE id = ?', [pl.variante_id]);
        if (!var_) throw new Error('Variante no encontrada');
        const cant = pl.cantidad || 1;


        let precioLinea = Number(var_.precio);
        
		//Suma el costo de los ingredientes EXTRA Agregados
        const extras = pl.agregados || [];
        for (const ingId of extras) {
          const [[ing]] = await conn.execute('SELECT precio_extra FROM ingredientes WHERE id = ?', [ingId]);
          if (ing) precioLinea += Number(ing.precio_extra);
        }

        //Suma al total global 
        total += precioLinea * cant;
     
        //Guarda el platillo en la reservación 
        const [rp] = await conn.execute(
          `INSERT INTO reservacion_platillos (reservacion_id, variante_id, cantidad, precio_unitario, notas) VALUES (?, ?, ?, ?, ?)`,
          [reservacion_id, var_.id, cant, precioLinea, pl.notas || null]
        );

        
		//Guarda ingredientes quitados 
        for (const ingId of (pl.quitados || [])) {
          await conn.execute(
            'INSERT INTO reservacion_platillo_opciones (reservacion_platillo_id, ingrediente_id, accion) VALUES (?, ?, ?)',
            [rp.insertId, ingId, 'quitar']
          );
        }
        
        // Guardar ingredientes agregados
        for (const ingId of (pl.agregados || [])) {
          await conn.execute(
            'INSERT INTO reservacion_platillo_opciones (reservacion_platillo_id, ingrediente_id, accion) VALUES (?, ?, ?)',
            [rp.insertId, ingId, 'agregar']
          );
        }
      }
    }
	//Actualiza la reservacion principal con el TOTAL calculado (Salon + Inflables + Comida)
    await conn.execute('UPDATE reservaciones SET total = ? WHERE id = ?', [total, reservacion_id]);


	//Confirma y guarda los cambios en la base de datos
    await conn.commit();
    conn.release();
    res.json({ success: true, message: 'Reservación creada con éxito', reservacion_id });
  } catch (err) {
    await conn.rollback();
    conn.release();
    
    console.error('Error al crear reservación:', err);
    res.status(500).json({ success: false, message: err.message || 'Error en el servidor' });
  }
});


// Ruta para elimiar una reservacion

app.delete('/api/reservaciones/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [result] = await conn.execute('DELETE FROM reservaciones WHERE id = ?', [id]);
    
    if (result.affectedRows === 0) {
      throw new Error('Reservación no encontrada');
    }

    await conn.commit();
    conn.release();
    res.json({ success: true, message: 'Reservación eliminada correctamente' });
  } catch (err) {
    await conn.rollback();
    conn.release();
    console.error('Error al eliminar reservación:', err);
    res.status(500).json({ success: false, message: err.message || 'Error en el servidor' });
  }
});







// ==================== GESTIÓN ADMIN (CONTADURÍA, USUARIOS Y SESIONES) ====================
app.get('/api/contaduria', requireAdmin, async (req, res) => {
  try {
    const [gananciasTotal] = await pool.execute(`SELECT COALESCE(SUM(monto), 0) AS ganancias_totales FROM pagos`);
    const [reservaciones] = await pool.execute(`SELECT id, cliente_nombre, cliente_telefono, fecha, estado, total AS total_orden FROM reservaciones ORDER BY fecha DESC`);
    res.json({ success: true, ganancias: gananciasTotal[0].ganancias_totales, reservaciones });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error en contaduría' });
  }
});

app.get('/users', requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT id, nombre, email, is_admin, created_at FROM usuarios');
    res.json({ success: true, users: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error' });
  }
});

app.get('/sessions', requireAdmin, async (req, res) => {
  try {
    const rows = await knexInstance('sessions').select('sid', 'sess', 'expired').orderBy('expired', 'desc');
    const sessions = rows.map(r => {
      let data = {};
      try { data = typeof r.sess === 'string' ? JSON.parse(r.sess) : (r.sess || {}); } catch (_) {}
      return { sid: r.sid, user: data.user || null, loginAt: data.loginAt || null, ip: data.ip || null, userAgent: data.userAgent || null, expired: r.expired };
    }).filter(s => s.user);
    res.json({ success: true, sessions });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error' });
  }
});

app.delete('/sessions/:sid', requireAdmin, async (req, res) => {
  try {
    await knexInstance('sessions').where('sid', req.params.sid).del();
    res.json({ success: true, message: 'Sesión cerrada' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error' });
  }
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Servidor activo en http://localhost:${port}`);
});
