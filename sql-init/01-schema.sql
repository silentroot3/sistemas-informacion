-- ==================================================
-- ESQUEMA DE BASE DE DATOS: SALÓN DE EVENTOS Y POS
-- ==================================================

-- 1. Tabla de Usuarios (ya la crea app.js, pero la dejamos por seguridad)
CREATE TABLE IF NOT EXISTS usuarios (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(100) NOT NULL,
  email VARCHAR(100) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  is_admin TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Salones (Chico: cap 30, 1 inflable | Mediano: cap 60, 2 inflables | Grande: cap 100, 2 inflables)
CREATE TABLE IF NOT EXISTS salones (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(100) NOT NULL,
  capacidad INT NOT NULL,
  max_inflables INT NOT NULL DEFAULT 1,
  precio_base DECIMAL(10,2) NOT NULL,
  activo TINYINT(1) DEFAULT 1
);

INSERT INTO salones (id, nombre, capacidad, max_inflables, precio_base) VALUES
(1, 'Salón Chico', 30, 1, 2500.00),
(2, 'Salón Mediano', 60, 2, 4500.00),
(3, 'Salón Grande', 100, 2, 7000.00)
ON DUPLICATE KEY UPDATE nombre=nombre;

-- 3. Inflables
CREATE TABLE IF NOT EXISTS inflables (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(100) NOT NULL,
  precio DECIMAL(10,2) NOT NULL,
  activo TINYINT(1) DEFAULT 1
);

INSERT INTO inflables (id, nombre, precio) VALUES
(1, 'Castillo Hinchable Infantil', 600.00),
(2, 'Tobogán Acuático de Obstáculos', 950.00),
(3, 'Brincolín de Dinosaurios', 750.00)
ON DUPLICATE KEY UPDATE nombre=nombre;

-- 4. Ingredientes (para personalizar hamburguesas y comida)
CREATE TABLE IF NOT EXISTS ingredientes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(100) NOT NULL,
  categoria VARCHAR(50) NOT NULL, -- ej: 'hamburguesa', 'pizza'
  precio_extra DECIMAL(10,2) DEFAULT 0.00,
  activo TINYINT(1) DEFAULT 1
);

INSERT INTO ingredientes (id, nombre, categoria, precio_extra) VALUES
(1, 'Carne de Res Extra', 'hamburguesa', 25.00),
(2, 'Queso Cheddar', 'hamburguesa', 12.00),
(3, 'Tocino Crujiente', 'hamburguesa', 15.00),
(4, 'Cebolla Caramelizada', 'hamburguesa', 10.00),
(5, 'Jalapeños', 'hamburguesa', 8.00),
(6, 'Aguacate', 'hamburguesa', 18.00)
ON DUPLICATE KEY UPDATE nombre=nombre;

-- 5. Platillos del Menú
CREATE TABLE IF NOT EXISTS platillos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(100) NOT NULL,
  categoria VARCHAR(50) NOT NULL, -- 'pizza', 'hamburguesa', 'bebida', 'malteada'
  activo TINYINT(1) DEFAULT 1
);

INSERT INTO platillos (id, nombre, categoria) VALUES
(1, 'Pizza Pepperoni', 'pizza'),
(2, 'Pizza Hawaiana', 'pizza'),
(3, 'Hamburguesa Clásica', 'hamburguesa'),
(4, 'Hamburguesa Doble Carne', 'hamburguesa'),
(5, 'Refresco de Cola 600ml', 'bebida'),
(6, 'Agua de Horchata 1L', 'bebida'),
(7, 'Malteada de Fresa', 'malteada'),
(8, 'Malteada de Chocolate', 'malteada')
ON DUPLICATE KEY UPDATE nombre=nombre;

-- 6. Variantes de Platillos (tamaños o tipos)
CREATE TABLE IF NOT EXISTS platillo_variantes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  platillo_id INT NOT NULL,
  nombre VARCHAR(100) NOT NULL, -- ej: 'Mediana', 'Grande', 'Individual'
  precio DECIMAL(10,2) NOT NULL,
  FOREIGN KEY (platillo_id) REFERENCES platillos(id) ON DELETE CASCADE
);

INSERT INTO platillo_variantes (id, platillo_id, nombre, precio) VALUES
(1, 1, 'Mediana (8 porciones)', 180.00),
(2, 1, 'Grande (12 porciones)', 240.00),
(3, 2, 'Mediana (8 porciones)', 190.00),
(4, 2, 'Grande (12 porciones)', 250.00),
(5, 3, 'Sencilla con papas', 120.00),
(6, 4, 'Doble con doble queso', 160.00),
(7, 5, 'Botella 600ml', 25.00),
(8, 6, 'Jarra 1 Litro', 50.00),
(9, 7, 'Vaso 500ml', 65.00),
(10, 8, 'Vaso 500ml', 65.00)
ON DUPLICATE KEY UPDATE nombre=nombre;

-- 7. Ingredientes por defecto que trae cada variante de hamburguesa
CREATE TABLE IF NOT EXISTS variante_ingredientes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  variante_id INT NOT NULL,
  ingrediente_id INT NOT NULL,
  incluido_default TINYINT(1) DEFAULT 1,
  FOREIGN KEY (variante_id) REFERENCES platillo_variantes(id) ON DELETE CASCADE,
  FOREIGN KEY (ingrediente_id) REFERENCES ingredientes(id) ON DELETE CASCADE
);

INSERT INTO variante_ingredientes (variante_id, ingrediente_id, incluido_default) VALUES
(5, 2, 1), -- Hamburguesa Sencilla incluye Queso Cheddar
(5, 4, 1), -- Incluye Cebolla
(6, 1, 1), -- Hamburguesa Doble incluye Carne Extra
(6, 2, 1), -- Incluye Queso
(6, 3, 1)  -- Incluye Tocino
ON DUPLICATE KEY UPDATE incluido_default=incluido_default;

-- 8. Reservaciones
CREATE TABLE IF NOT EXISTS reservaciones (
  id INT AUTO_INCREMENT PRIMARY KEY,
  cliente_nombre VARCHAR(150) NOT NULL,
  cliente_telefono VARCHAR(50),
  cliente_email VARCHAR(100),
  salon_id INT NOT NULL,
  fecha DATE NOT NULL,
  hora_inicio TIME NOT NULL,
  hora_fin TIME NOT NULL,
  num_personas INT NOT NULL,
  estado VARCHAR(50) DEFAULT 'pendiente',
  notas TEXT,
  total DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  created_by INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (salon_id) REFERENCES salones(id),
  FOREIGN KEY (created_by) REFERENCES usuarios(id)
);

-- 9. Inflables contratados en una reservación
CREATE TABLE IF NOT EXISTS reservacion_inflables (
  id INT AUTO_INCREMENT PRIMARY KEY,
  reservacion_id INT NOT NULL,
  inflable_id INT NOT NULL,
  cantidad INT DEFAULT 1,
  precio_unitario DECIMAL(10,2) NOT NULL,
  FOREIGN KEY (reservacion_id) REFERENCES reservaciones(id) ON DELETE CASCADE,
  FOREIGN KEY (inflable_id) REFERENCES inflables(id)
);

-- 10. Platillos de la reservación
CREATE TABLE IF NOT EXISTS reservacion_platillos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  reservacion_id INT NOT NULL,
  variante_id INT NOT NULL,
  cantidad INT NOT NULL DEFAULT 1,
  precio_unitario DECIMAL(10,2) NOT NULL,
  notas TEXT,
  FOREIGN KEY (reservacion_id) REFERENCES reservaciones(id) ON DELETE CASCADE,
  FOREIGN KEY (variante_id) REFERENCES platillo_variantes(id)
);

-- 11. Opciones de quitar/agregar ingredientes en platillos de la reservación
CREATE TABLE IF NOT EXISTS reservacion_platillo_opciones (
  id INT AUTO_INCREMENT PRIMARY KEY,
  reservacion_platillo_id INT NOT NULL,
  ingrediente_id INT NOT NULL,
  accion VARCHAR(20) NOT NULL, -- 'quitar' o 'agregar'
  FOREIGN KEY (reservacion_platillo_id) REFERENCES reservacion_platillos(id) ON DELETE CASCADE,
  FOREIGN KEY (ingrediente_id) REFERENCES ingredientes(id)
);

-- 12. Tabla de Pagos / Contaduría
CREATE TABLE IF NOT EXISTS pagos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  reservacion_id INT NOT NULL,
  monto DECIMAL(10,2) NOT NULL,
  metodo_pago VARCHAR(50) DEFAULT 'efectivo',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (reservacion_id) REFERENCES reservaciones(id) ON DELETE CASCADE
);
