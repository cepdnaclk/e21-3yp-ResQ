import { redirect } from 'next/navigation'

type PageProps = {
  params: Promise<{ id: string }>
}

export default async function InstructorStudentLegacyRedirectPage({ params }: PageProps) {
  const { id } = await params
  const numericId = Number.parseInt(id, 10)
  const normalizedId = Number.isFinite(numericId) ? `manikin-${String(numericId).padStart(2, '0')}` : id

  redirect(`/student/dashboard?manikinId=${encodeURIComponent(normalizedId)}`)
}
