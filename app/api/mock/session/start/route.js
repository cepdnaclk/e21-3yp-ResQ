import { startSession } from '@/lib/hubState'

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}))
    const activeSession = await startSession({
      manikinId: body?.manikinId,
      traineeId: body?.traineeId,
    })

    return Response.json({ activeSession }, { status: 200 })
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : 'Unable to start session.',
      },
      { status: 500 }
    )
  }
}