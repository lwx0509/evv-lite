import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import EVVLogin from './EVVLogin'
import EVVDashboard from './EVVDashboard'
import MobileCheckin from './MobileCheckin'
import QRPrint from './QRPrint'
import App from './App'
import VideoOnly from './VideoOnly'
import './index.css'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<EVVLogin />} />
        <Route path="/dashboard" element={<EVVDashboard />} />
        <Route path="/mobile" element={<MobileCheckin />} />
        <Route path="/qr/:clientId" element={<QRPrint />} />
        <Route path="/player" element={<App />} />
        <Route path="/video" element={<VideoOnly />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
)
