require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const mongoose = require('mongoose');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const chatRoutes = require('./routes/chat');
const uploadRoutes = require('./routes/upload');
const initSocket = require('./socket/index');
const { verifySmtpConnection } = require('./utils/email');

const app = express();
const server = http.createServer(app);

// ── Socket.IO setup ────────────────────────────────────────────────────
const io = new Server(server, {
  cors: {
    origin: '*', // In production, restrict to your app domain
    methods: ['GET', 'POST'],
  },
});
app.set('io', io); // make io accessible in routes via req.app.get('io')
initSocket(io);

// ── Express middleware ─────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ── Serve uploaded images as static files ──────────────────────────────────
const path = require('path');
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ── Routes ─────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/upload', uploadRoutes);

// Health check
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Luvstor Backend',
    version: '2.0.0',
    features: ['OTP Auth via SMTP', 'Real-time Chat (WebSocket)', 'Nearby People (Geospatial)'],
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found` });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ── MongoDB connection + server start ──────────────────────────────────
const PORT = process.env.PORT || 5000;
mongoose
  .connect(process.env.MONGODB_URI)
  .then(async () => {
    console.log('✅ MongoDB connected:', process.env.MONGODB_URI);
    try {
      await verifySmtpConnection();
    } catch (smtpErr) {
      console.error('❌ SMTP connection failed:', smtpErr.message);
      if (process.env.NODE_ENV === 'production') {
        process.exit(1);
      }
      console.warn('   Server starting anyway (non-production). Fix SMTP in .env to send emails.');
    }
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`❌ Port ${PORT} is already in use. Stop the other server or run:`);
        console.error(`   netstat -ano | findstr :${PORT}`);
        console.error(`   taskkill /PID <pid> /F`);
        process.exit(1);
      }
      throw err;
    });

    server.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 Luvstor server running on http://localhost:${PORT}`);
      console.log(`📱 On your phone use: http://<your-pc-ip>:${PORT} (same Wi‑Fi as this PC)`);
      console.log(`🔌 WebSocket listening on ws://0.0.0.0:${PORT}`);
      console.log(`📧 Auth: POST /api/auth/send-otp  |  POST /api/auth/verify-otp`);
    });
  })
  .catch(err => {
    console.error('❌ MongoDB connection error:', err.message);
    process.exit(1);
  });
