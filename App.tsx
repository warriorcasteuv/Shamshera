import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from './Layout'
import { Admin } from './Admin'
import { Account } from './Account'
import { EventPage } from './Eventpage'
import { Home } from './Home'
import { AdminLogin, Login } from './Login'
import { MyBets } from './Mybets'
import { SportPage } from './Sportpage'
import { Casino } from './Casino'
import { Ludo } from './Ludo'
export default function App() {
  return (
       <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/admin-login" element={<AdminLogin />} />
        <Route element={<Layout />}>
          <Route path="/" element={<Home />} />
          <Route path="/sport/:sportId" element={<SportPage />} />
          <Route path="/casino" element={<Casino />} />
          <Route path="/casino/ludo" element={<Ludo />} />
          <Route path="/casino/:gameId" element={<Casino />} />
          <Route path="/event/:eventId" element={<EventPage />} />
          <Route path="/bets" element={<MyBets />} />
          <Route path="/account" element={<Account />} />
          <Route path="/admin" element={<Admin />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}