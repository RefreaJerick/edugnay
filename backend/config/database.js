const mysql = require('mysql2/promise');

const requiredVariables = ['DB_HOST', 'DB_USER', 'DB_NAME'];
const missingVariables = requiredVariables.filter(name => !process.env[name]);

const database = missingVariables.length
  ? null
  : mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: Number(process.env.DB_CONNECTION_LIMIT) || 10,
    queueLimit: 0,
    enableKeepAlive: true,
    multipleStatements: false
  });

function getDatabase() {
  if (database) return database;

  const error = new Error('Database configuration is incomplete.');
  error.status = 503;
  throw error;
}

function isDatabaseConfigured() {
  return Boolean(database);
}

async function checkDatabaseConnection() {
  if (!database) return false;

  let connection;

  try {
    connection = await database.getConnection();
    await connection.query('SELECT 1');
    return true;
  } catch {
    return false;
  } finally {
    connection?.release();
  }
}

module.exports = { checkDatabaseConnection, getDatabase, isDatabaseConfigured };
