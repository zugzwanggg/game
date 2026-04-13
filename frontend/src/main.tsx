import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { VoiceModeProvider } from './context/VoiceModeProvider.tsx'
import { AuthProvider } from './context/AuthProvider.tsx'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <VoiceModeProvider>
      <AuthProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </AuthProvider>
    </VoiceModeProvider>
  </StrictMode>,
)
