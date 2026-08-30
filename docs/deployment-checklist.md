# Deployment Checklist

## Code
- [ ] Production build succeeds (`npm run build` all workspaces)
- [ ] Full test suite passes (55 pytest + 39 vitest)
- [ ] No debug code / console.debug left
- [ ] No secrets committed (.env gitignored; secret scan clean)

## Database
- [ ] `prisma migrate deploy` verified on fresh database
- [ ] Backup procedure documented & scheduled (pg_dump + uploads/ + ml/models/)
- [ ] Restore tested once

## ML
- [ ] Active model version explicit in `ml/models/active.json`
- [ ] MANIFEST.json sha256 matches artifact
- [ ] Class mapping matches classes.json
- [ ] Preprocessing identical to training (shared code path)

## API
- [ ] `/api/health` returns healthy
- [ ] Upload validation (type/size) rejects bad input with 415/422
- [ ] Rate limiting enabled; error handler hides stack traces
- [ ] WEB_ORIGIN CORS set to production origin

## Frontend
- [ ] Production build served over HTTPS
- [ ] Responsive layout verified (mobile/tablet/desktop)
- [ ] Error and empty states verified

## Security
- [ ] Strong POSTGRES_PASSWORD via environment
- [ ] ML service not exposed publicly (internal network only)
- [ ] helmet() active; no secrets in responses/logs
- [ ] npm audit reviewed

## Monitoring
- [ ] Request-ID logging active on both services
- [ ] `/health` endpoints wired to uptime monitor
- [ ] `/insights` dashboard reachable for researchers

## Research integrity
- [ ] Dataset frozen version recorded on promoted ModelVersion
- [ ] Test split untouched since evaluation
- [ ] Phase-6 artifacts preserved unmodified
- [ ] Traceability matrix current
