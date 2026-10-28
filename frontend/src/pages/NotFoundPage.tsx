import { Link } from 'react-router-dom'
import { EmptyState } from '@/components/EmptyState'
import { ROUTES } from '@/lib/constants'

export default function NotFoundPage() {
  return (
    <EmptyState
      title="Page not found"
      description="That address doesn't match any page in SmartChunk."
      action={
        <Link to={ROUTES.landing} className="btn btn-primary">
          Back to home
        </Link>
      }
    />
  )
}
