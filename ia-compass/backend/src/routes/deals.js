const express = require('express');
const router = express.Router();
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
  try {
    const deals = await prisma.deal.findMany({
      where: { contact: { accountId } },
      include: { contact: true, stage: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json(deals);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  const { contactId, stageId, value } = req.body;
  if (!contactId || !stageId) return res.status(400).json({ error: 'contactId and stageId required' });
  try {
    const deal = await prisma.deal.create({
      data: { contactId, stageId, value: parseFloat(value) || 0 },
      include: { contact: true, stage: true },
    });
    res.status(201).json(deal);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  const { stageId, value } = req.body;
  const data = {};
  if (stageId !== undefined) data.stageId = stageId;
  if (value !== undefined) data.value = parseFloat(value);
  try {
    const deal = await prisma.deal.update({
      where: { id: req.params.id },
      data,
      include: { contact: true, stage: true },
    });
    res.json(deal);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await prisma.deal.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
