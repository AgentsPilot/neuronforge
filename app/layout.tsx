// app/layout.tsx

import './globals.css'
import { Inter } from 'next/font/google'
import { UserProvider } from '@/components/UserProvider'
import { Toaster } from 'sonner'
import { SafeSystemInitializer } from '@/components/SafeSystemInitializer'

const inter = Inter({ subsets: ['latin'] })

export const metadata = {
  title: 'NeuronForge',
  description: 'Build your own AI workflows and agents',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <UserProvider>
          <SafeSystemInitializer />
          {children}
          <Toaster richColors position="top-center" />
        </UserProvider>
      </body>
    </html>
  )
}