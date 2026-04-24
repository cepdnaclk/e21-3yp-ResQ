import { enrichTelemetry } from '@/lib/hubState'

export async function GET(request) {
  try {
    const manikinId = request.nextUrl.searchParams.get('manikinId')?.trim() || undefined
    const telemetry = await enrichTelemetry(manikinId)
    return Response.json(telemetry, { status: 200 })
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : 'Unable to load live telemetry.',
      },
      { status: 500 }
    )
  }
}