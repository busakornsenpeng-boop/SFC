# Verification & Validation Traceability

| Workflow / risk | Verification | Evidence |
| --- | --- | --- |
| JWT and role boundaries | `tests/unit/adminAuth.test.js` | Vitest report |
| Repair wait time and Job ID calculation | `tests/unit/repairWorkflow.test.js` | Vitest coverage |
| HTTP headers, CORS, hidden LINE test endpoint | `tests/api/app.test.js` | Supertest output |
| Login page availability with mock API | `tests/e2e/login.spec.js` | Playwright HTML report |
| Hard-coded secret/test endpoint regression | `scripts/security-static-check.js` | CI security stage |

Use `docs/BUG-REGISTER.md` for every defect: severity, reproduction, expected/actual result, root cause, fix, and regression-test reference.
