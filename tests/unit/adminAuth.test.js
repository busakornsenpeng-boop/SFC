const express = require('express');
const request = require('supertest');
const { requireAuth, requireRole, verifyAdminToken, signToken, getRequiredEnv } = require('../../middleware/adminAuth');

function buildApp(middleware) {
  const app = express();
  app.get('/protected', middleware, (req, res) => res.json({ success: true, role: (req.user || req.admin).role }));
  return app;
}

describe('authentication middleware', () => {
  it('rejects missing and malformed tokens', async () => {
    const app = buildApp(requireAuth);
    expect((await request(app).get('/protected')).status).toBe(401);
    expect((await request(app).get('/protected').set('Authorization', 'Bearer invalid')).status).toBe(401);
  });

  it('blocks role escalation', async () => {
    const app = buildApp(requireRole('admin'));
    const token = signToken({ username: 'user', role: 'user' });
    expect((await request(app).get('/protected').set('Authorization', `Bearer ${token}`)).status).toBe(403);
  });

  it('requires configuration and accepts an allowed role', async () => {
    expect(() => getRequiredEnv('UNSET_VV_CONFIGURATION')).toThrow('UNSET_VV_CONFIGURATION must be configured.');
    const app = buildApp(requireRole('technician'));
    const token = signToken({ username: 'tech', role: 'technician' });
    expect((await request(app).get('/protected').set('Authorization', `Bearer ${token}`)).status).toBe(200);
  });

  it('accepts a valid authenticated user and valid admin', async () => {
    const userApp = buildApp(requireAuth);
    const userToken = signToken({ username: 'user', role: 'user' });
    expect((await request(userApp).get('/protected').set('Authorization', `Bearer ${userToken}`)).body.role).toBe('user');

    const adminApp = buildApp(verifyAdminToken);
    const adminToken = signToken({ username: 'admin', role: 'admin' });
    expect((await request(adminApp).get('/protected').set('Authorization', `Bearer ${adminToken}`)).status).toBe(200);
  });
});
