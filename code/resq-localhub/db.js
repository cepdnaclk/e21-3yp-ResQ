// db.js
const { Pool } = require('pg');

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'resq_db',
  password: 'New1',
  port: 5432,
});

async function testDB() {
  try {
    const res = await pool.query('SELECT NOW()');
    console.log('DB Connected:', res.rows[0]);
  } catch (err) {
    console.error('DB Error:', err.message);
  }
}

module.exports = { pool, testDB };