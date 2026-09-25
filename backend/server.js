require('dotenv').config();

const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { checkDatabaseConnection } = require('./config/database');
const { errorHandler } = require('./middleware/errorHandler');
const authRoutes = require('./routes/auth');

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
app.use('/api/auth', authRoutes);

app.get('/api/health', async (req, res) => {
  const databaseConnected = await checkDatabaseConnection();

  res.status(databaseConnected ? 200 : 503).json({
    message: databaseConnected ? 'Academix API and database are running.' : 'Academix API is running, but the database is unavailable.',
    database: databaseConnected ? 'connected' : 'unavailable'
  });
});

app.use(errorHandler);

app.listen(port, () => {
  console.log(`Academix API is running on port ${port}.`);
});
