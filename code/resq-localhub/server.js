const express = require('express');
const { pool } = require('./db');

const app = express();
app.use(express.json());

// Create session API
app.post('/session', async (req, res) => {
  try {
    const { trainee_id, instructor_id, device_id } = req.body;

    const result = await pool.query(
      `INSERT INTO sessions (trainee_id, instructor_id, device_id, started_at)
       VALUES ($1, $2, $3, NOW())
       RETURNING session_id`,
      [trainee_id, instructor_id, device_id]
    );

    res.json({
      message: 'Session created',
      session_id: result.rows[0].session_id
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create session' });
  }
});

app.listen(3000, () => {
  console.log('Server running on port 3000');
});