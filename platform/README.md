# RuView Monitoring Platform

Multi-tenant platform for installing and operating camera-free home monitoring built on
[RuView](../README.md) WiFi CSI sensing. One operations console for the installer/operator,
a private dashboard for every client, and a home gateway per property.

| Path | What |
|---|---|
| `docs/ARCHITECTURE.md` | Technical assessment of RuView, architecture, data model, protocols |
| `docs/DEPLOYMENT.md` | Supabase, web app, firmware releases, gateways, operations |
| `docs/INSTALLER-GUIDE.md` | Field procedure: bare boards → verified installation |
| `docs/CHECKLIST.md` | Completed features, outstanding work, testing status |
| `supabase/` | Migrations (schema, RLS, logic), local config, SQL tests |
| `shared/` | Gateway protocol (zod), ESP32 packet codecs, NVS partition generator |
| `gateway-agent/` | `ruview-agent` (UDP tap + cloud bridge) and gateway deploy kit |
| `web/` | Next.js app: `/admin` console, `/app` client portal, `/api/gateway/v1` |

```bash
npm ci
npm test && npm run test:db && npm run test:e2e
npm run build
```

RuView itself (firmware, sensing server) is used unmodified.
