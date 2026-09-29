/**
 * SIH26074 - Panchayat Weather
 * SPA Router: Hash-based navigation with smooth transitions between tabs
 */

class Router {
  constructor() {
    this.routes = ['home', 'map', 'advice', 'profile'];
    this.currentRoute = 'home';
    this.viewport = null;
  }

  init() {
    this.viewport = document.querySelector('.app-content-viewport');

    // Handle hash change events
    window.addEventListener('hashchange', () => this.handleHashChange());

    // Bind bottom nav click events
    document.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        const targetRoute = item.dataset.tab;
        if (targetRoute && this.routes.includes(targetRoute)) {
          window.location.hash = `#${targetRoute}`;
        }
      });
    });

    // Initial route check
    this.handleHashChange();
  }

  handleHashChange() {
    const rawHash = window.location.hash.replace('#', '').trim();
    const route = this.routes.includes(rawHash) ? rawHash : 'home';

    if (window.Auth && !window.Auth.isAuthenticated()) {
      window.Auth.showLoginScreen();
      return;
    }

    this.navigateTo(route);
  }

  navigateTo(route) {
    if (!this.routes.includes(route)) return;

    if (window.Auth && !window.Auth.isAuthenticated()) {
      window.Auth.showLoginScreen();
      return;
    }

    this.currentRoute = route;

    if (window.location.hash !== `#${route}`) {
      window.location.hash = `#${route}`;
    }

    // Update active nav item
    document.querySelectorAll('.nav-item').forEach(item => {
      item.classList.toggle('active', item.dataset.tab === route);
    });

    // Update screen views with smooth 0.3s transition
    document.querySelectorAll('.screen-view').forEach(view => {
      const isTarget = view.id === `view-${route}`;
      if (isTarget) {
        view.classList.add('active');
      } else {
        view.classList.remove('active');
      }
    });

    // Reset scroll position to top
    if (this.viewport) {
      this.viewport.scrollTo({ top: 0, behavior: 'smooth' });
    }

    if (window.handleRouteNavigation) {
      window.handleRouteNavigation();
    }
  }
}

window.Router = new Router();
