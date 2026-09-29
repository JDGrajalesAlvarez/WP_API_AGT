require('dotenv').config();
const express = require('express');
const webhookRoutes = require('./src/routes/webhookRoutes'); // Ajusta la ruta a tus archivos

const app = express();

// OBLIGATORIO: Debe ir antes de app.use() de las rutas
app.use(express.json());

// Montar las rutas
app.use('/', webhookRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor escuchando en el puerto ${PORT}`);
});