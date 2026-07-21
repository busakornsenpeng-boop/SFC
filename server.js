const dotenv = require('dotenv');
dotenv.config();

const required = ['JWT_SECRET', 'ADMIN_USERNAME', 'ADMIN_PASSWORD', 'TE_SHARED_USERNAME', 'TE_SHARED_PASSWORD'];
if (process.env.NODE_ENV === 'production') {
  const missing = required.filter(name => !process.env[name]);
  if (missing.length) throw new Error(`Missing required production configuration: ${missing.join(', ')}`);
}

const { createApp } = require('./app');
const app = createApp();
const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`Server listening on http://localhost:${port}`));
