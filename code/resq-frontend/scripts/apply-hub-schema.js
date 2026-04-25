const fs = require('fs')
const { Client } = require('pg')

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return

  const envText = fs.readFileSync(filePath, 'utf8')
  for (const rawLine of envText.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue

    const idx = line.indexOf('=')
    if (idx === -1) continue

    const key = line.slice(0, idx).trim()
    let value = line.slice(idx + 1).trim()

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }

    if (!(key in process.env)) {
      process.env[key] = value
    }
  }
}

async function main() {
  loadDotEnv('.env.local')

  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error('DATABASE_URL is missing in process env and .env.local')
  }

  const needsSsl =
    connectionString.includes('rds.') ||
    connectionString.includes('amazonaws.com') ||
    process.env.DATABASE_SSL === 'true'

  const sql = fs.readFileSync('db/hub_runtime.sql', 'utf8')
  const client = new Client({
    connectionString,
    ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
  })

  await client.connect()
  await client.query(sql)
  await client.end()

  console.log('hub_runtime.sql applied successfully')
}

main().catch((error) => {
  console.error('Failed applying hub_runtime.sql:', error.message)
  process.exit(1)
})
