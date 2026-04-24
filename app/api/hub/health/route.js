import { computeHealth } from '@/lib/hubState'

export async function GET() {
  try {
    const health = await computeHealth()
    return Response.json(health, { status: 200 })
  } catch (error) {
    return Response.json(
      {
        backendHealth: 'error',
        message: error instanceof Error ? error.message : 'Unable to read hub health.',
      },
      { status: 500 }
    )
  }
}