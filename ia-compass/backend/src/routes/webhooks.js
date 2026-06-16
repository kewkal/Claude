const router = require('express').Router();
const { PrismaClient } = require('@prisma/client');
const { enrollContact } = require('../services/sequenceRunner');

const prisma = new PrismaClient();

router.post('/:accountId/contact', async (req, res) => {
  try {
    const { accountId } = req.params;
    const { firstName, lastName, email, phone, tags, sequenceId } = req.body;

    const account = await prisma.account.findUnique({ where: { id: accountId } });
    if (!account) return res.status(404).json({ error: 'Account not found' });

    let contact = null;
    if (email) {
      contact = await prisma.contact.findFirst({ where: { accountId, email } });
    }

    if (!contact) {
      contact = await prisma.contact.create({
        data: { firstName: firstName || '', lastName: lastName || '', email, phone, tags: tags || [], source: 'WEBHOOK', accountId },
      });
    }

    if (sequenceId) {
      const existing = await prisma.sequenceEnrollment.findFirst({
        where: { contactId: contact.id, sequenceId, status: 'ACTIVE' },
      });
      if (!existing) {
        const enrollment = await prisma.sequenceEnrollment.create({
          data: { contactId: contact.id, sequenceId },
        });
        await enrollContact(enrollment.id);
      }
    }

    res.json({ success: true, contact });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
