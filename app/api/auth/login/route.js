import { query } from '@/lib/db'

async function verifyAuthorizedStudent(email, studentId) {
  const result = await query(
    `SELECT student_id, email, full_name
     FROM authorized_students
     WHERE LOWER(email) = LOWER($1)
       AND UPPER(TRIM(student_id)) = UPPER(TRIM($2))
       AND is_active = TRUE
     LIMIT 1`,
    [email, studentId]
  )

  return result.rows[0] ?? null
}

export async function POST(request) {
  try {
    const body = await request.json()
    const role = body?.role === 'instructor' ? 'instructor' : 'student'
    const email = String(body?.email ?? '').trim()
    const password = String(body?.password ?? '')
    const studentId = String(body?.studentId ?? '').trim()

    if (!email || !password) {
      return Response.json({ error: 'Please enter both email and password' }, { status: 400 })
    }

    if (!email.includes('@')) {
      return Response.json({ error: 'Please enter a valid email address' }, { status: 400 })
    }

    if (password.length < 6) {
      return Response.json({ error: 'Password must be at least 6 characters' }, { status: 400 })
    }

    if (role === 'instructor') {
      return Response.json({ success: true, redirectTo: '/dashboard/instructor' }, { status: 200 })
    }

    if (!process.env.DATABASE_URL) {
      return Response.json(
        { error: 'Server is not configured: DATABASE_URL is missing.' },
        { status: 500 }
      )
    }

    if (!studentId) {
      return Response.json({ error: 'Please enter your student ID' }, { status: 400 })
    }

    const authorizedStudent = await verifyAuthorizedStudent(email, studentId)

    if (!authorizedStudent) {
      return Response.json(
        { error: 'Access denied. This email and student ID are not authorized.' },
        { status: 401 }
      )
    }

    return Response.json(
      {
        success: true,
        redirectTo: '/student/dashboard',
        student: {
          studentId: authorizedStudent.student_id,
          email: authorizedStudent.email,
          name: authorizedStudent.full_name,
        },
      },
      { status: 200 }
    )
  } catch (err) {
    console.error('Login API error:', err)

    if (err.code === '42P01') {
      return Response.json(
        {
          error:
            'Authorization table not found. Run the SQL setup script to create authorized_students.',
        },
        { status: 500 }
      )
    }

    return Response.json({ error: 'Login failed due to a server error.' }, { status: 500 })
  }
}
