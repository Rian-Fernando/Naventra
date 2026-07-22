import { lazy, Suspense, useEffect, useState } from 'react';
import Landing from './pages/Landing.jsx';
import InfoPage from './pages/InfoPage.jsx';

// The live console pulls in three.js, the engine and the hooks — defer it so a
// first-time visitor landing on "/" doesn't pay for it up front.
const Console = lazy(() => import('./Console.jsx'));

const INFO_ROUTES = ['/privacy', '/data', '/about'];

// Path-based routing so /live and /guide are real, crawlable URLs. Internal
// <a href> clicks are intercepted into pushState; legacy #/guide links still land.
//   /        → marketing landing page
//   /live    → live ATC console
//   /guide   → operator's guide (rendered inside the console shell)
function usePathRoute() {
  const [route, setRoute] = useState(window.location.pathname);
  useEffect(() => {
    if (window.location.hash.startsWith('#/guide')) {
      window.history.replaceState(null, '', '/guide');
      setRoute('/guide');
    }
    const onPop = () => setRoute(window.location.pathname);
    const onClick = (e) => {
      const a = e.target.closest('a');
      if (!a || a.origin !== window.location.origin || a.target === '_blank') return;
      if (a.hasAttribute('download') || a.getAttribute('rel') === 'external') return;
      // Leave in-page hash links (#section) to their own handlers / native scroll.
      if ((a.getAttribute('href') || '').startsWith('#')) return;
      e.preventDefault();
      window.history.pushState(null, '', a.pathname);
      setRoute(a.pathname);
      window.scrollTo(0, 0);
    };
    window.addEventListener('popstate', onPop);
    document.addEventListener('click', onClick);
    return () => {
      window.removeEventListener('popstate', onPop);
      document.removeEventListener('click', onClick);
    };
  }, []);
  return route;
}

export default function App() {
  const route = usePathRoute();
  if (route.startsWith('/live') || route.startsWith('/guide')) {
    return (
      <Suspense fallback={<div className="boot-splash">Loading live console…</div>}>
        <Console route={route} />
      </Suspense>
    );
  }
  if (INFO_ROUTES.some((p) => route.startsWith(p))) return <InfoPage route={route} />;
  return <Landing />;
}
