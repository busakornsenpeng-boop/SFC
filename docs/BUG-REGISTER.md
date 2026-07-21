# Bug Register

| ID | Severity | Reproduction / impact | Root cause | Fix / regression evidence | Status |
| --- | --- | --- | --- | --- | --- |
| SEC-001 | High | A known fallback JWT secret could forge tokens if environment configuration was missing. | Secret fallback was embedded in authentication middleware. | Removed fallback; `adminAuth.test.js` verifies protected routes. | Fixed |
| SEC-002 | High | The LINE notification test endpoint could be requested without authorization. | Diagnostic route was registered unconditionally. | Route is disabled by default and requires admin token when enabled; `app.test.js`. | Fixed |
| SEC-003 | Medium | Any browser origin could call APIs cross-origin. | Global default CORS middleware. | Allowlist-only CORS in `app.js`; `app.test.js`. | Fixed |
| DEP-001 | High | Production dependency audit reports 11 high findings in `googleapis`/`exceljs` dependency trees. | Upstream packages currently resolve to vulnerable transitive versions with no non-breaking fix. | Release remains blocked; track upstream updates and replace affected Excel/Google client packages if a supported fixed release is unavailable. | Open |
| DEP-002 | High | Development dependency `xlsx` has prototype-pollution/ReDoS advisories with no upstream patch. | Legacy import tooling depends on SheetJS community package. | Keep untrusted spreadsheets out of the import path; replace with a maintained parser before enabling untrusted uploads. | Open |
