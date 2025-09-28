const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');
const calendar = google.calendar('v3');

const app = express();
const PORT = process.env.PORT || 8080;

// Configuración CORS más permisiva para desarrollo
const corsOptions = {
  origin: [
    'https://lemachine.cl',
    'http://lemachine.cl',
    'https://www.lemachine.cl',
    'http://localhost:3000',
    'http://127.0.0.1:3000'
  ],
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  optionsSuccessStatus: 200
};

// Middleware CORS
app.use(cors(corsOptions));

// Middleware para manejar preflight requests
app.options('*', cors(corsOptions));

// Middleware para parsing JSON
app.use(express.json());

// Configuración
const CALENDAR_ID = '33f2b860648ddfba6f555ad436e9546153c69c1391de0143aad37415e76bc6a8@group.calendar.google.com';

// Ruta de salud
app.get('/', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Backend de reservas funcionando',
    timestamp: new Date().toISOString(),
    endpoints: {
      disponibilidad: 'GET /disponibilidad',
      agendar: 'POST /agendar'
    }
  });
});

// Ruta de salud adicional
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy',
    service: 'reservas-backend',
    timestamp: new Date().toISOString()
  });
});

// Obtener disponibilidad
app.get('/disponibilidad', async (req, res) => {
  try {
    console.log('🔍 Obteniendo disponibilidad...');
    
    // Autenticación con Service Account
    const auth = new google.auth.GoogleAuth({
      keyFile: './service-account-key.json',
      scopes: ['https://www.googleapis.com/auth/calendar'],
    });

    const authClient = await auth.getClient();

    // Obtener eventos del calendario (próximos 90 días)
    const timeMin = new Date().toISOString();
    const timeMax = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();

    console.log(`📅 Buscando eventos desde ${timeMin} hasta ${timeMax}`);

    const response = await calendar.events.list({
      auth: authClient,
      calendarId: CALENDAR_ID,
      timeMin: timeMin,
      timeMax: timeMax,
      singleEvents: true,
      orderBy: 'startTime',
    });

    const eventos = response.data.items;
    const fechasOcupadas = [];

    console.log(`📊 Encontrados ${eventos.length} eventos`);

    eventos.forEach(evento => {
      const inicio = new Date(evento.start.date || evento.start.dateTime);
      const fin = new Date(evento.end.date || evento.end.dateTime);
      
      // Agregar todas las fechas entre inicio y fin
      let fechaActual = new Date(inicio);
      while (fechaActual < fin) {
        const fechaString = fechaActual.toISOString().split('T')[0];
        fechasOcupadas.push(fechaString);
        fechaActual.setDate(fechaActual.getDate() + 1);
      }
    });

    // Eliminar duplicados
    const fechasUnicas = [...new Set(fechasOcupadas)];
    
    console.log(`✅ Fechas ocupadas procesadas: ${fechasUnicas.length}`);

    res.json({
      success: true,
      fechasOcupadas: fechasUnicas,
      totalEventos: eventos.length,
      calendarId: CALENDAR_ID
    });

  } catch (error) {
    console.error('❌ Error obteniendo disponibilidad:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Error al obtener la disponibilidad del calendario'
    });
  }
});

// Crear reserva
app.post('/agendar', async (req, res) => {
  // Log headers para debugging
  console.log('📨 Headers recibidos:', req.headers);
  console.log('📝 Body recibido:', req.body);

  try {
    const { checkInDate, checkOutDate, name, email, phone, guests, message } = req.body;

    console.log('🏡 Creando reserva para:', { name, email, checkInDate, checkOutDate });

    // Validaciones
    if (!checkInDate || !checkOutDate || !name || !email || !phone || !guests) {
      return res.status(400).json({
        success: false,
        message: 'Faltan campos requeridos'
      });
    }

    // Autenticación con Service Account
    const auth = new google.auth.GoogleAuth({
      keyFile: './service-account-key.json',
      scopes: ['https://www.googleapis.com/auth/calendar.readonly', 'https://www.googleapis.com/auth/calendar.events'],
    });

    const authClient = await auth.getClient();

    // Crear evento en el calendario
    const event = {
      summary: `🏡 Reserva Cabaña: ${name}`,
      description: `
Reserva de Cabaña - Sistema Automático
--------------------------------------
👤 Nombre: ${name}
📧 Email: ${email}
📞 Teléfono: ${phone}
👥 Huéspedes: ${guests} personas
📅 Check-in: ${checkInDate}
📅 Check-out: ${checkOutDate}
💬 Mensaje: ${message || 'No especificado'}

Estado: Confirmada ✅
      `,
      start: {
        date: checkInDate,
        timeZone: 'America/Santiago',
      },
      end: {
        date: checkOutDate,
        timeZone: 'America/Santiago',
      },
      colorId: '2', // Color verde para confirmado
    };

    console.log('📅 Creando evento en Google Calendar...');

    const response = await calendar.events.insert({
      auth: authClient,
      calendarId: CALENDAR_ID,
      resource: event,
    });

    // Generar código de reserva
    const reservationCode = `CB-${new Date().getFullYear()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;

    console.log('✅ Reserva creada exitosamente:', reservationCode);

    res.json({
      success: true,
      eventId: response.data.id,
      reservationCode: reservationCode,
      message: 'Reserva creada exitosamente en Google Calendar',
      eventLink: response.data.htmlLink
    });

  } catch (error) {
    console.error('❌ Error creando reserva:', error);
    
    // Error más detallado
    let errorMessage = 'Error al crear la reserva en el calendario';
    if (error.code === 403) {
      errorMessage = 'Error de permisos. Verifica que el Service Account tenga acceso al calendario.';
    } else if (error.code === 404) {
      errorMessage = 'Calendario no encontrado. Verifica el Calendar ID.';
    }

    res.status(500).json({
      success: false,
      error: error.message,
      message: errorMessage,
      details: {
        code: error.code,
        calendarId: CALENDAR_ID
      }
    });
  }
});

// Ruta de prueba para verificar Service Account
app.get('/test-calendar', async (req, res) => {
  try {
    const auth = new google.auth.GoogleAuth({
      keyFile: './service-account-key.json',
      scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
    });

    const authClient = await auth.getClient();
    
    const response = await calendar.calendars.get({
      auth: authClient,
      calendarId: CALENDAR_ID,
    });

    res.json({
      success: true,
      calendar: {
        id: response.data.id,
        summary: response.data.summary,
        timeZone: response.data.timeZone,
        access: response.data.accessRole
      }
    });

  } catch (error) {
    console.error('❌ Error testeando calendario:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Error accediendo al calendario'
    });
  }
});

// Manejo de errores global
app.use((error, req, res, next) => {
  console.error('💥 Error global:', error);
  res.status(500).json({
    success: false,
    message: 'Error interno del servidor',
    error: error.message
  });
});

// Ruta 404
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Ruta no encontrada'
  });
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`🚀 Servidor de reservas corriendo en puerto ${PORT}`);
  console.log(`📅 Calendar ID: ${CALENDAR_ID}`);
  console.log(`🌐 CORS configurado para: lemachine.cl`);
  console.log(`🕒 Iniciado en: ${new Date().toISOString()}`);
});