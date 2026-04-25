import { getActiveSession } from '@/lib/hubState'

export async function GET(request) {
  try {
    const manikinId = request.nextUrl.searchParams.get('manikinId')?.trim() || undefined
    const activeSession = await getActiveSession(manikinId)
    return Response.json({ activeSession }, { status: 200 })
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : 'Unable to load active session.',
      },
      { status: 500 }
    )
  }
}