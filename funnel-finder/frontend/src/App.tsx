import { Routes, Route } from 'react-router-dom'
import { Home } from './pages/Home'
import { FunnelPage } from './pages/FunnelPage'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/ad/:id" element={<FunnelPage />} />
    </Routes>
  )
}
