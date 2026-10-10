const config = require('./config');
const app = require('./app');

app.listen(config.port, () => console.log(`API on http://localhost:${config.port}`));
