import { EventList } from './Eventlist'
import { LiveCricketBoard } from './LiveCricket'
import { useSherabet } from './store'
export function Home() {
  const allEvents = useSherabet((s) => s.events)
  const events = allEvents.filter((e) => e.inPlay && e.sport !== 'cricket')
  return (
    <section>
      <LiveCricketBoard />
      <div className="page-head">
        <div>
          <h2>Other in-play sports</h2>
          <p>Cricket scores and upcoming matches are listed above.</p>
        </div>
        <div className="legend">
          <span className="pill back">Back</span>
          <span className="pill lay">Lay</span>
        </div>
      </div>
      <EventList events={events} />
    </section>
  )
}