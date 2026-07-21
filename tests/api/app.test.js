const request = require('supertest');
const { createApp } = require('../../app');

describe('application security boundary', () => {
  it('serves the UI with security headers and hides the test endpoint by default', async () => {
    const app = createApp();
    const home = await request(app).get('/');
    expect(home.status).toBe(200);
    expect(home.headers['x-content-type-options']).toBe('nosniff');
    expect((await request(app).post('/api/test-line-notify')).status).toBe(404);
  });

  it('denies untrusted CORS origins and unauthenticated admin access', async () => {
    const app = createApp();
    expect((await request(app).get('/api/admin/me')).status).toBe(401);
    expect((await request(app).get('/').set('Origin', 'https://untrusted.example')).status).toBe(403);
  });
});
