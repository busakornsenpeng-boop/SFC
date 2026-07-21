require('./setup');
const { createApp } = require('../app');
const port = Number(process.env.PLAYWRIGHT_PORT || 4173);
createApp().listen(port, () => console.log(`E2E server on ${port}`));
