import { query } from '@/lib/db'

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const studentId = searchParams.get('student_id') ?? searchParams.get('studentId')

    if (!studentId) {
      return Response.json(
        { error: 'Missing student_id or studentId query parameter' },
        { status: 400 }
      )
    }

    let result
    try {
      result = await query(
        'SELECT * FROM session_logs WHERE student_id = $1 ORDER BY created_at DESC',
        [studentId]
      )
    } catch (orderErr) {
      if (orderErr.code === '42703' && orderErr.message?.includes('created_at')) {
        result = await query('SELECT * FROM session_logs WHERE student_id = $1', [studentId])
      } else {
        throw orderErr
      }
    }

    return Response.json(result.rows, { status: 200 })
  } catch (err) {
    console.error('Sessions API error:', err)
    return Response.json(
      {
        error: 'Database connection or query failed',
        details: err.message,
        code: err.code,
      },
      { status: 500 }
    )
  }
}
