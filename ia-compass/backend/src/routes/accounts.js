const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const auth = require('../middleware/auth');

const prisma = new PrismaClient();

router.use(auth);

router.get('/', async (req, res) => {
  if (req.user.role !== 'AGENCY_ADMIN') return res.status(403).json({ error: 'Forbidden' });
  const accounts = await prisma.account.findMany({
    where: { agencyId: req.user.agencyId },
    include: { _count: { select: { contacts: true } } },
  });
  res.json(accounts);
});

router.post('/', async (req, res) => {
  if (req.user.role !== 'AGENCY_ADMIN') return res.status(403).json({ error: 'Forbidden' });
  try {
    const { name, clientName, clientEmail, clientPassword } = req.body;
    const account = await prisma.account.create({
      data: { name, agencyId: req.user.agencyId },
    });

    if (clientEmail && clientPassword) {
      const hashed = await bcrypt.hash(clientPassword, 10);
      await prisma.user.create({
        data: {
          email: clientEmail,
          password: hashed,
          name: clientName || name,
          role: 'CLIENT',
          agencyId: req.user.agencyId,
          accountId: account.id,
        },
      });
    }

    await prisma.pipeline.create({
      data: {
        name: 'Main Pipeline',
        accountId: account.id,
        stages: {
          create: [
            { name: 'New Lead', order: 0, color: '#38BDF8' },
            { name: 'Contacted', order: 1, color: '#818CF8' },
            { name: 'Qualified', order: 2, color: '#FB923C' },
            { name: 'Closed', order: 3, color: '#34D399' },
          ],
        },
      },
    });

    res.json(account);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
