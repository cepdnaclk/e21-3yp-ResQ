import { endSession } from '@/lib/hubState'

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}))
    const result = await endSession({ sessionId: body?.sessionId })

    if (!result) {
      return Response.json({ error: 'No active session matches the request.' }, { status: 404 })
    }

    return Response.json(result, { status: 200 })
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : 'Unable to end session.',
      },
      { status: 500 }
    )
  }
}