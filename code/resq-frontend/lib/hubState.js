import { query } from '@/lib/db'

function normalizeStatus(status) {
  const normalized = String(status ?? '').toLowerCase()
  if (normalized === 'online' || normalized === 'degraded' || normalized === 'offline') {
    return normalized
  }
  return 'offline'
}

function toActiveSession(row) {
  if (!row) return null
  return {
    sessionId: row.session_id,
    manikinId: row.manikin_id,
    traineeId: row.trainee_id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    status: row.status,
  }
}

async function getActiveSession(manikinId) {
  const params = []
  const whereClause = []

  if (manikinId) {
    params.push(String(manikinId).trim())
    whereClause.push(`manikin_id = $${params.length}`)
  }

  whereClause.push(`status = 'active'`)

  const result = await query(
    `SELECT session_id, manikin_id, trainee_id, started_at, ended_at, status
     FROM training_sessions
     WHERE ${whereClause.join(' AND ')}
     ORDER BY started_at DESC
     LIMIT 1`,
    params
  )

  return toActiveSession(result.rows[0])
}

async function enrichTelemetry(manikinId) {
  const normalizedManikinId = manikinId ? String(manikinId).trim() : ''
  const activeSession = await getActiveSession(normalizedManikinId || undefined)

  const params = []
  const whereClause = ['m.is_active = TRUE']

  if (normalizedManikinId) {
    params.push(normalizedManikinId)
    whereClause.push(`m.manikin_id = $${params.length}`)
  }

  const result = await query(
    `SELECT
       m.manikin_id,
       m.manikin_name,
       COALESCE(s.recorded_at, NOW()) AS timestamp,
       COALESCE(s.depth_mm, 0) AS depth_mm,
       COALESCE(s.rate_cpm, 0) AS rate_cpm,
       COALESCE(s.recoil_ok, FALSE) AS recoil_ok,
       COALESCE(s.pauses, 0) AS pauses,
       COALESCE(s.battery_level, m.battery_level, 0) AS battery_level,
       COALESCE(s.connection_status, m.connection_status, 'offline') AS connection_status,
       COALESCE(s.flags, ARRAY[]::TEXT[]) AS flags
     FROM manikins m
     LEFT JOIN LATERAL (
       SELECT recorded_at, depth_mm, rate_cpm, recoil_ok, pauses, battery_level, connection_status, flags
       FROM manikin_telemetry_samples mts
       WHERE mts.manikin_id = m.manikin_id
       ORDER BY recorded_at DESC
       LIMIT 1
     ) s ON TRUE
      WHERE ${whereClause.join(' AND ')}
      ORDER BY m.manikin_id`,
     params
  )

  return result.rows.map((row) => {
    const baseFlags = Array.isArray(row.flags) ? row.flags : []
    const flags = activeSession?.manikinId === row.manikin_id ? ['Active session', ...baseFlags] : baseFlags

    return {
      manikinId: row.manikin_id,
      manikinName: row.manikin_name,
      timestamp: new Date(row.timestamp).toISOString(),
      depthMm: Number(row.depth_mm),
      rateCpm: Number(row.rate_cpm),
      recoilOk: Boolean(row.recoil_ok),
      pauses: Number(row.pauses),
      batteryLevel: Number(row.battery_level),
      connectionStatus: normalizeStatus(row.connection_status),
      flags,
    }
  })
}

async function computeHealth() {
  const startedAt = Date.now()
  const [manikinResult, sampleResult] = await Promise.all([
    query(
      `SELECT
         COUNT(*) FILTER (WHERE is_active = TRUE) AS active_manikins,
         COUNT(*) FILTER (WHERE is_active = TRUE AND connection_status = 'online') AS online_manikins
       FROM manikins`
    ),
    query('SELECT MAX(recorded_at) AS last_sample_at FROM manikin_telemetry_samples'),
  ])

  const activeManikins = Number(manikinResult.rows[0]?.active_manikins ?? 0)
  const onlineManikins = Number(manikinResult.rows[0]?.online_manikins ?? 0)
  const lastSampleAt = sampleResult.rows[0]?.last_sample_at
  const responseTimeMs = Date.now() - startedAt

  if (!lastSampleAt) {
    return {
      backendHealth: 'offline',
      message: 'Database is connected, but no telemetry samples are available yet.',
      responseTimeMs,
      lastCheckedAt: new Date().toISOString(),
    }
  }

  return {
    backendHealth: onlineManikins > 0 ? 'online' : 'offline',
    message: `${onlineManikins}/${activeManikins} manikins reporting telemetry from PostgreSQL.`,
    responseTimeMs,
    lastCheckedAt: new Date().toISOString(),
  }
}

async function startSession({ manikinId, traineeId }) {
  const normalizedManikinId = String(manikinId ?? '').trim()
  const normalizedTraineeId = String(traineeId ?? 'trainee-local').trim() || 'trainee-local'

  if (!normalizedManikinId) {
    throw new Error('A manikin must be selected before starting a session.')
  }

  const manikinResult = await query(
    `SELECT manikin_id
     FROM manikins
     WHERE manikin_id = $1
       AND is_active = TRUE
     LIMIT 1`,
    [normalizedManikinId]
  )

  if (!manikinResult.rows[0]) {
    throw new Error('Selected manikin was not found in the backend database.')
  }

  const existingActive = await getActiveSession()
  if (existingActive) {
    return existingActive
  }

  const sessionId = `session-${Date.now()}`

  const result = await query(
    `INSERT INTO training_sessions (session_id, manikin_id, trainee_id, started_at, status)
     VALUES ($1, $2, $3, NOW(), 'active')
     RETURNING session_id, manikin_id, trainee_id, started_at, ended_at, status`,
    [sessionId, normalizedManikinId, normalizedTraineeId]
  )

  return toActiveSession(result.rows[0])
}

async function endSession({ sessionId } = {}) {
  const activeResult = await query(
    `SELECT session_id, manikin_id, trainee_id, started_at, ended_at, status
     FROM training_sessions
     WHERE status = 'active'
     ORDER BY started_at DESC
     LIMIT 1`
  )

  const active = activeResult.rows[0]
  if (!active) {
    return null
  }

  if (sessionId && sessionId !== active.session_id) {
    return null
  }

  const closedResult = await query(
    `UPDATE training_sessions
     SET status = 'ended', ended_at = NOW()
     WHERE session_id = $1
     RETURNING session_id, manikin_id, trainee_id, started_at, ended_at, status`,
    [active.session_id]
  )

  const closedSession = closedResult.rows[0]

  const metricsResult = await query(
    `SELECT
       COUNT(*)::INT AS sample_count,
       COALESCE(ROUND(AVG(depth_mm))::INT, 0) AS avg_depth_mm,
       COALESCE(ROUND(AVG(rate_cpm))::INT, 0) AS avg_rate_cpm,
       COALESCE(ROUND(100 * AVG(CASE WHEN recoil_ok THEN 1 ELSE 0 END))::INT, 0) AS recoil_ok_pct,
       COALESCE(ROUND(100 * AVG(CASE WHEN depth_mm BETWEEN 50 AND 60 AND rate_cpm BETWEEN 100 AND 120 AND recoil_ok THEN 1 ELSE 0 END))::INT, 0) AS compliance_pct,
       COALESCE(MAX(pauses), 0)::INT AS pauses_detected
     FROM manikin_telemetry_samples
     WHERE manikin_id = $1
       AND recorded_at >= $2
       AND recorded_at <= $3`,
    [closedSession.manikin_id, closedSession.started_at, closedSession.ended_at]
  )

  const metrics = metricsResult.rows[0] ?? {}

  let sampleCount = Number(metrics.sample_count ?? 0)
  let avgDepthMm = Number(metrics.avg_depth_mm ?? 0)
  let avgRateCpm = Number(metrics.avg_rate_cpm ?? 0)
  let recoilOkPct = Number(metrics.recoil_ok_pct ?? 0)
  let compliancePct = Number(metrics.compliance_pct ?? 0)
  let pausesDetected = Number(metrics.pauses_detected ?? 0)

  if (sampleCount === 0) {
    const latestSampleResult = await query(
      `SELECT depth_mm, rate_cpm, recoil_ok, pauses
       FROM manikin_telemetry_samples
       WHERE manikin_id = $1
       ORDER BY recorded_at DESC
       LIMIT 1`,
      [closedSession.manikin_id]
    )

    const latestSample = latestSampleResult.rows[0]
    if (latestSample) {
      sampleCount = 1
      avgDepthMm = Number(latestSample.depth_mm)
      avgRateCpm = Number(latestSample.rate_cpm)
      recoilOkPct = latestSample.recoil_ok ? 100 : 0
      compliancePct = latestSample.recoil_ok && avgDepthMm >= 50 && avgDepthMm <= 60 && avgRateCpm >= 100 && avgRateCpm <= 120 ? 100 : 0
      pausesDetected = Number(latestSample.pauses ?? 0)
    }
  }

  const summaryPayload = {
    sessionId: closedSession.session_id,
    manikinId: closedSession.manikin_id,
    traineeId: closedSession.trainee_id,
    startedAt: closedSession.started_at,
    endedAt: closedSession.ended_at,
    sampleCount,
    avgDepthMm,
    avgRateCpm,
    recoilOkPct,
    compliancePct,
    handPlacementPct: null,
    pausesDetected,
    longestPauseSec: Number((pausesDetected * 0.9 + 1).toFixed(1)),
  }

  await query(
    `INSERT INTO session_summaries (
       session_id, manikin_id, trainee_id, started_at, ended_at,
       sample_count, avg_depth_mm, avg_rate_cpm, recoil_ok_pct, compliance_pct,
       hand_placement_pct, pauses_detected, longest_pause_sec
     ) VALUES (
       $1, $2, $3, $4, $5,
       $6, $7, $8, $9, $10,
       $11, $12, $13
     )
     ON CONFLICT (session_id)
     DO UPDATE SET
       ended_at = EXCLUDED.ended_at,
       sample_count = EXCLUDED.sample_count,
       avg_depth_mm = EXCLUDED.avg_depth_mm,
       avg_rate_cpm = EXCLUDED.avg_rate_cpm,
       recoil_ok_pct = EXCLUDED.recoil_ok_pct,
       compliance_pct = EXCLUDED.compliance_pct,
       hand_placement_pct = EXCLUDED.hand_placement_pct,
       pauses_detected = EXCLUDED.pauses_detected,
       longest_pause_sec = EXCLUDED.longest_pause_sec`,
    [
      summaryPayload.sessionId,
      summaryPayload.manikinId,
      summaryPayload.traineeId,
      summaryPayload.startedAt,
      summaryPayload.endedAt,
      summaryPayload.sampleCount,
      summaryPayload.avgDepthMm,
      summaryPayload.avgRateCpm,
      summaryPayload.recoilOkPct,
      summaryPayload.compliancePct,
      summaryPayload.handPlacementPct,
      summaryPayload.pausesDetected,
      summaryPayload.longestPauseSec,
    ]
  )

  return {
    activeSession: {
      sessionId: closedSession.session_id,
      manikinId: closedSession.manikin_id,
      traineeId: closedSession.trainee_id,
      startedAt: closedSession.started_at,
      endedAt: closedSession.ended_at,
      status: 'ended',
    },
    summary: summaryPayload,
  }
}

async function getLastSummary(manikinId) {
  const params = []
  const whereClause = []

  if (manikinId) {
    params.push(String(manikinId).trim())
    whereClause.push(`manikin_id = $${params.length}`)
  }

  const result = await query(
    `SELECT
       session_id,
       manikin_id,
       trainee_id,
       started_at,
       ended_at,
       sample_count,
       avg_depth_mm,
       avg_rate_cpm,
       recoil_ok_pct,
       compliance_pct,
       hand_placement_pct,
       pauses_detected,
       longest_pause_sec
      FROM session_summaries
      ${whereClause.length > 0 ? `WHERE ${whereClause.join(' AND ')}` : ''}
     ORDER BY ended_at DESC NULLS LAST
      LIMIT 1`,
     params
  )

  const row = result.rows[0]
  if (!row) return null

  return {
    sessionId: row.session_id,
    manikinId: row.manikin_id,
    traineeId: row.trainee_id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    sampleCount: Number(row.sample_count),
    avgDepthMm: Number(row.avg_depth_mm),
    avgRateCpm: Number(row.avg_rate_cpm),
    recoilOkPct: Number(row.recoil_ok_pct),
    compliancePct: Number(row.compliance_pct),
    handPlacementPct: row.hand_placement_pct == null ? undefined : Number(row.hand_placement_pct),
    pausesDetected: row.pauses_detected == null ? undefined : Number(row.pauses_detected),
    longestPauseSec: row.longest_pause_sec == null ? undefined : Number(row.longest_pause_sec),
  }
}

export {
  computeHealth,
  enrichTelemetry,
  endSession,
  getActiveSession,
  getLastSummary,
  startSession,
}
