import { Pool } from 'pg'

const connectionString = process.env.DATABASE_URL
const needsSsl =
  connectionString &&
  (connectionString.includes('rds.') ||
    connectionString.includes('amazonaws.com') ||
    process.env.DATABASE_SSL === 'true')

const pool = new Pool({
  connectionString,
  ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
})

/**
 * Run a parameterized query against the database.
 * @param {string} text - SQL query (use $1, $2, ... for parameters)
 * @param {unknown[]} [params] - Optional array of parameter values
 * @returns {Promise<import('pg').QueryResult>} Query result with .rows, .rowCount, etc.
 */
function query(text, params) {
  return pool.query(text, params ?? [])
}

export { query, pool }
