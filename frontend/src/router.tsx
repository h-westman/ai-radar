import { createBrowserRouter, Navigate, type RouteObject } from 'react-router'
import AppShell, { LAST_TEAM_KEY } from './components/AppShell'
import { readString } from './lib/storage'
import CatalogPage from './pages/CatalogPage'
import NotFound from './pages/NotFound'
import PracticePage from './pages/PracticePage'
import RadarPage from './pages/RadarPage'
import TeamsPage from './pages/TeamsPage'

export function HomeRedirect() {
  const lastTeam = readString(LAST_TEAM_KEY)
  return <Navigate replace to={lastTeam ? `/radar/team/${lastTeam}` : '/radar/org'} />
}

export const routes: RouteObject[] = [
  {
    element: <AppShell />,
    children: [
      { index: true, element: <HomeRedirect /> },
      { path: 'radar/org', element: <RadarPage /> },
      { path: 'radar/team/:teamRef', element: <RadarPage /> },
      { path: 'practices', element: <CatalogPage /> },
      { path: 'practices/:practiceRef', element: <PracticePage /> },
      { path: 'teams', element: <TeamsPage /> },
      { path: '*', element: <NotFound /> },
    ],
  },
]

export const router = createBrowserRouter(routes)
