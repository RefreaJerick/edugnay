require('dotenv').config();

const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { checkDatabaseConnection, isDatabaseConfigured } = require('./config/database');
const { errorHandler } = require('./middleware/errorHandler');
const authRoutes = require('./routes/auth');
const attendanceRoutes = require('./routes/attendance');
const accountSetupRoutes = require('./routes/accountSetup');
const emailRoutes = require('./routes/email');
const qrAttendanceRoutes = require('./routes/qrAttendance');
const profilesRoutes = require('./routes/profiles');
const sectionsRoutes = require('./routes/sections');
const schoolsRoutes = require('./routes/schools');
const academicTermsRoutes = require('./routes/academicTerms');
const usersRoutes = require('./routes/users');
const userImportRoutes = require('./routes/userImport');

const app = express();
const port = Number(process.env.PORT) || 3000;
const frontendOrigin = process.env.FRONTEND_ORIGIN || 'http://127.0.0.1:5500';

app.use(helmet());
app.use(cors({ origin: frontendOrigin, credentials: true }));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false
}));

app.get('/api/health', async (req, res) => {
  const databaseConnected = await checkDatabaseConnection();
  const environmentConfigured = isDatabaseConfigured() && Boolean(process.env.FRONTEND_ORIGIN);
  const isHealthy = databaseConnected && environmentConfigured;

  res.status(isHealthy ? 200 : 503).json({
    message: isHealthy ? 'Academix API, database, and environment are ready.' : 'Academix API is running, but setup is incomplete.',
    database: databaseConnected ? 'connected' : 'unavailable',
    environment: environmentConfigured ? 'configured' : 'incomplete'
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/account-setup', accountSetupRoutes);
app.use('/api/email', emailRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/qr-attendance', qrAttendanceRoutes);
app.use('/api/profile', profilesRoutes);
app.use('/api/sections', sectionsRoutes);
app.use('/api', schoolsRoutes);
app.use('/api', academicTermsRoutes);
app.use('/api/users/import', userImportRoutes);
app.use('/api/users', usersRoutes);

app.use(errorHandler);

const server = app.listen(port, () => {
  console.log(`Academix API is running on port ${port}.`);
});

server.on('error', error => {
  console.error('Academix API could not start.');
  console.error(error.message);
  process.exitCode = 1;
});
