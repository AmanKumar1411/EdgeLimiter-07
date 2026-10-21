# UI screenshots

`before/`: the dashboard before the redesign (dark only).
`after/`: the redesign in light and dark, plus 375 px mobile.

Regenerate against a fresh local backend:

```bash
cd dashboard
SCREENSHOT_DIR=$PWD/../docs/ui/after SCREENSHOT_SCHEMES=light,dark npx playwright test screenshots
```

| Before | After |
|---|---|
| `before/public-landing.jpg` | `after/public-landing-light.jpg` |
| `before/client-policies.jpg` | `after/client-limits-light.jpg` |
| `before/client-analytics.jpg` | `after/client-overview-light.jpg`, `after/client-overview-dark.jpg` |
| `before/client-security.jpg` | `after/client-activity-dark.jpg` |
| `before/client-live-control.jpg` | `after/client-test-request-light.jpg` |
| `before/admin-tenants.jpg` | `after/admin-tenants-light.jpg`, `after/admin-tenant-overview-light.jpg` |
| `before/mobile-dashboard.jpg` | `after/mobile-overview-light.jpg`, `after/mobile-limits-light.jpg`, `after/mobile-menu-dark.jpg` |
