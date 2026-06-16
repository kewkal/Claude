const router = require('express').Router();
const { PrismaClient } = require('@prisma/client');
const auth = require('../middleware/auth');

const prisma = new PrismaClient();
router.use(auth);

function getAccountId(req) {
  return req.user.role === 'AGENCY_ADMIN'
    ? req.query.accountId || req.body.accountId
    : req.user.accountId;
}

router.get('/', async (req, res) => {
  const accountId = getAccountId(req);
  if (!accountId) return res.status(400).json({ error: 'accountId required' });
  const pipelines = await prisma.pipeline.findMany({
    where: { accountId },
    include: { stages: { orderBy: { order: 'asc' }, include: { deals: { include: { contact: true } } } } },
  });
  res.json(pipelines);
});

router.post('/', async (req, res) => {
  try {
    const accountId = getAccountId(req);
    const { name } = req.body;
    const pipeline = await prisma.pipeline.create({
      data: {
        name,
        accountId,
        stages: {
          create: [
            { name: 'New Lead', order: 0, color: '#38BDF8' },
            { name: 'Contacted', order: 1, color: '#818CF8' },
            { name: 'Qualified', order: 2, color: '#FB923C' },
            { name: 'Closed', order: 3, color: '#34D399' },
          ],
        },
      },
      include: { stages: true },
    });
    res.json(pipeline);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/deals', async (req, res) => {
  const accountId = getAccountId(req);
  if (!accountId) return res.status(400).json({ error: 'accountId required' });
  const deals = await prisma.deal.findMany({
    where: { contact: { accountId } },
    include: { contact: true, stage: true },
  });
  res.json(deals);
});

router.post('/deals', async (req, res) => {
  try {
    const { contactId, stageId, value } = req.body;
    const deal = await prisma.deal.create({
      data: { contactId, stageId, value: parseFloat(value) || 0 },
      include: { contact: true, stage: true },
    });
    res.json(deal);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/deals/:id', async (req, res) => {
  try {
    const { stageId, value } = req.body;
    const deal = await prisma.deal.update({
      where: { id: req.params.id },
      data: { stageId, ...(value !== undefined && { value: parseFloat(value) }) },
      include: { contact: true, stage: true },
    });
    res.json(deal);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
