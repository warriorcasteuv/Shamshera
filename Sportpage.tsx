import { useParams } from 'react-router-dom'
import { EventList } from './Eventlist'
import { sportLabel } from './catalog'
import { LiveCricketBoard } from './LiveCricket'
import { useSherabet } from './store'
import type { SportId } from './types'
export function SportPage() {
  const { sportId } = useParams()
  const allEvents = useSherabet((s) => s.events)
  const events = allEvents.filter((e) => e.sport === sportId)
  const label = sportLabel(sportId as SportId)
  if (sportId === 'cricket') return <LiveCricketBoard />
  return (
    <section>
      <div className="page-head">
        <div>
          <h2>{label}</h2>
          <p>Open an event to see extra markets and settlement.</p>
        </div>
      </div>
      <EventList events={events} />
    </section>
  )
}