const router = require('express').Router();
const { PrismaClient } = require('@prisma/client');
const auth = require('../middleware/auth');
const { enrollContact } = require('../services/sequenceRunner');

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
  const sequences = await prisma.sequence.findMany({
    where: { accountId },
    include: { _count: { select: { steps: true, enrollments: true } } },
    orderBy: { createdAt: 'desc' },
  });
  res.json(sequences);
});

router.post('/', async (req, res) => {
  try {
    const accountId = getAccountId(req);
    const { name, triggerType } = req.body;
    const sequence = await prisma.sequence.create({
      data: { name, triggerType: triggerType || 'MANUAL', accountId },
    });
    res.json(sequence);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  const sequence = await prisma.sequence.findUnique({
    where: { id: req.params.id },
    include: {
      steps: { orderBy: { order: 'asc' } },
      enrollments: {
        include: { contact: true },
        orderBy: { startedAt: 'desc' },
        take: 50,
      },
    },
  });
  if (!sequence) return res.status(404).json({ error: 'Not found' });
  res.json(sequence);
});

router.post('/:id/steps', async (req, res) => {
  try {
    const { stepType, delayMinutes, subject, body, order } = req.body;
    const step = await prisma.sequenceStep.create({
      data: { sequenceId: req.params.id, stepType, delayMinutes: parseInt(delayMinutes) || 0, subject, body, order: parseInt(order) || 0 },
    });
    res.json(step);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id/steps/:stepId', async (req, res) => {
  try {
    const { stepType, delayMinutes, subject, body, order } = req.body;
    const step = await prisma.sequenceStep.update({
      where: { id: req.params.stepId },
      data: { stepType, delayMinutes: parseInt(delayMinutes), subject, body, order: parseInt(order) },
    });
    res.json(step);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id/steps/:stepId', async (req, res) => {
  await prisma.sequenceStep.delete({ where: { id: req.params.stepId } });
  res.json({ success: true });
});

router.post('/:id/enroll', async (req, res) => {
  try {
    const { contactIds } = req.body;
    const results = [];
    for (const contactId of contactIds) {
      const existing = await prisma.sequenceEnrollment.findFirst({
        where: { contactId, sequenceId: req.params.id, status: 'ACTIVE' },
      });
      if (existing) continue;
      const enrollment = await prisma.sequenceEnrollment.create({
        data: { contactId, sequenceId: req.params.id },
      });
      await enrollContact(enrollment.id);
      results.push(enrollment);
    }
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id/enrollments', async (req, res) => {
  const enrollments = await prisma.sequenceEnrollment.findMany({
    where: { sequenceId: req.params.id },
    include: { contact: true },
    orderBy: { startedAt: 'desc' },
  });
  res.json(enrollments);
});

module.exports = router;
