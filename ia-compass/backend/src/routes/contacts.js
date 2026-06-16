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
  const { search } = req.query;
  const contacts = await prisma.contact.findMany({
    where: {
      accountId,
      ...(search && {
        OR: [
          { firstName: { contains: search, mode: 'insensitive' } },
          { lastName: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
          { phone: { contains: search } },
        ],
      }),
    },
    orderBy: { createdAt: 'desc' },
  });
  res.json(contacts);
});

router.post('/', async (req, res) => {
  try {
    const accountId = getAccountId(req);
    if (!accountId) return res.status(400).json({ error: 'accountId required' });
    const { firstName, lastName, email, phone, tags, source } = req.body;
    const contact = await prisma.contact.create({
      data: { firstName, lastName, email, phone, tags: tags || [], source: source || 'MANUAL', accountId },
    });
    res.json(contact);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  const contact = await prisma.contact.findUnique({
    where: { id: req.params.id },
    include: { deals: { include: { stage: true } }, enrollments: { include: { sequence: true } } },
  });
  if (!contact) return res.status(404).json({ error: 'Not found' });
  res.json(contact);
});

router.put('/:id', async (req, res) => {
  try {
    const { firstName, lastName, email, phone, tags } = req.body;
    const contact = await prisma.contact.update({
      where: { id: req.params.id },
      data: { firstName, lastName, email, phone, tags },
    });
    res.json(contact);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  await prisma.contact.delete({ where: { id: req.params.id } });
  res.json({ success: true });
});

module.exports = router;
