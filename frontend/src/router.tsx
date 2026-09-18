import { createBrowserRouter, Navigate, type RouteObject } from 'react-router'
import AppShell, { LAST_RADAR_KEY } from './components/AppShell'
import { readString } from './lib/storage'
import CatalogPage from './pages/CatalogPage'
import NotFound from './pages/NotFound'
import PracticePage from './pages/PracticePage'
import RadarListPage from './pages/RadarListPage'
import RadarPage from './pages/RadarPage'

export function HomeRedirect() {
  const lastRadar = readString(LAST_RADAR_KEY)
  return <Navigate replace to={lastRadar ? `/radar/${lastRadar}` : '/radar/org'} />
}

export const routes: RouteObject[] = [
  {
    element: <AppShell />,
    children: [
      { index: true, element: <HomeRedirect /> },
      { path: 'radar/org', element: <RadarPage /> },
      { path: 'radar/:radarId', element: <RadarPage /> },
      { path: 'practices', element: <CatalogPage /> },
      { path: 'practices/:practiceId', element: <PracticePage /> },
      { path: 'radars', element: <RadarListPage /> },
      { path: '*', element: <NotFound /> },
    ],
  },
]

export const router = createBrowserRouter(routes)
