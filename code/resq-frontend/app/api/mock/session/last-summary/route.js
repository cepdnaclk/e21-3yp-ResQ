import { getLastSummary } from '@/lib/hubState'

export async function GET(request) {
  try {
    const manikinId = request.nextUrl.searchParams.get('manikinId')?.trim() || undefined
    const summary = await getLastSummary(manikinId)
    return Response.json(summary, { status: 200 })
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : 'Unable to load latest summary.',
      },
      { status: 500 }
    )
  }
}