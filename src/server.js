const dotenv = require('dotenv');
const { createApp } = require('./app');

dotenv.config();

const app = createApp();
const port = Number(process.env.PORT || 3000);

app.listen(port, () => {
  console.log(`Free LLM API Provider listening on http://localhost:${port}`);
});
