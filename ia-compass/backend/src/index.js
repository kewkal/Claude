const express = require('express');
const cors = require('cors');
const { startWorker } = require('./workers/sequenceWorker');

const app = express();

app.use(cors({ origin: '*' }));
app.use(express.json());

app.use('/api/auth', require('./routes/auth'));
app.use('/api/accounts', require('./routes/accounts'));
app.use('/api/contacts', require('./routes/contacts'));
app.use('/api/pipelines', require('./routes/pipelines'));
app.use('/api/sequences', require('./routes/sequences'));
app.use('/api/landing-pages', require('./routes/landingPages'));
app.use('/api/webhooks', require('./routes/webhooks'));

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`IA Compass backend running on port ${PORT}`);
  startWorker();
});
