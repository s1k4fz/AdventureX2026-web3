import { type RouteObject, Navigate, useRoutes } from 'react-router-dom'
import { RequireAuth } from '@/features/auth/RequireAuth'
import { AppLayout } from '@/layouts/AppLayout'
import { AgentTaskNewPage } from '@/pages/AgentTaskNewPage'
import { AgentTaskPage } from '@/pages/AgentTaskPage'
import { HomePage } from '@/pages/HomePage'
import { LandingPage } from '@/pages/LandingPage'
import { LoginPage } from '@/pages/LoginPage'
import { PolicyDetailPage } from '@/pages/PolicyDetailPage'
import { PolicyNFTPublicPage } from '@/pages/PolicyNFTPublicPage'
import { SchedulePage } from '@/pages/SchedulePage'
import { VaultPage } from '@/pages/VaultPage'
import { NFTCollectionPage } from '@/pages/NFTCollectionPage'
import { NotFoundPage } from '@/pages/NotFoundPage'

const routes: RouteObject[] = [
  {
    path: '/',
    element: <LandingPage />,
  },
  {
    path: '/login',
    element: <LoginPage />,
  },
  {
    path: '/nft/:tokenId',
    element: <PolicyNFTPublicPage />,
  },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppLayout />,
        children: [
          {
            path: 'home',
            element: <HomePage />,
          },
          {
            path: 'tasks/new',
            element: <AgentTaskNewPage />,
          },
          {
            path: 'tasks/:id',
            element: <AgentTaskPage />,
          },
          {
            // Compat: old new-task entry
            path: 'new',
            element: <Navigate to="/tasks/new" replace />,
          },
          {
            path: 'policy/:id',
            element: <PolicyDetailPage />,
          },
          {
            path: 'collection',
            element: <NFTCollectionPage />,
          },
          {
            path: 'vault',
            element: <VaultPage />,
          },
          {
            path: 'pool',
            element: <Navigate to="/vault" replace />,
          },
          {
            path: 'wallet',
            element: <Navigate to="/vault" replace />,
          },
          {
            path: 'schedule',
            element: <SchedulePage />,
          },
        ],
      },
    ],
  },
  {
    path: '*',
    element: <NotFoundPage />,
  },
]

export function AppRouter() {
  return useRoutes(routes)
}
