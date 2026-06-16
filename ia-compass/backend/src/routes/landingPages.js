const router = require('express').Router();
const { PrismaClient } = require('@prisma/client');
const auth = require('../middleware/auth');

const prisma = new PrismaClient();

function getAccountId(req) {
  return req.user.role === 'AGENCY_ADMIN'
    ? req.query.accountId || req.body.accountId
    : req.user.accountId;
}

router.get('/', auth, async (req, res) => {
  const accountId = getAccountId(req);
  if (!accountId) return res.status(400).json({ error: 'accountId required' });
  const pages = await prisma.landingPage.findMany({
    where: { accountId },
    include: { _count: { select: { submissions: true } } },
    orderBy: { createdAt: 'desc' },
  });
  res.json(pages);
});

router.post('/', auth, async (req, res) => {
  try {
    const accountId = getAccountId(req);
    const { name, slug } = req.body;
    const page = await prisma.landingPage.create({
      data: { name, slug: slug || name.toLowerCase().replace(/\s+/g, '-'), accountId, content: [] },
    });
    res.json(page);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', auth, async (req, res) => {
  const page = await prisma.landingPage.findUnique({ where: { id: req.params.id } });
  if (!page) return res.status(404).json({ error: 'Not found' });
  res.json(page);
});

router.put('/:id', auth, async (req, res) => {
  try {
    const { name, content } = req.body;
    const page = await prisma.landingPage.update({
      where: { id: req.params.id },
      data: { name, content },
    });
    res.json(page);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/publish', auth, async (req, res) => {
  const page = await prisma.landingPage.update({
    where: { id: req.params.id },
    data: { published: true },
  });
  res.json(page);
});

router.post('/:id/unpublish', auth, async (req, res) => {
  const page = await prisma.landingPage.update({
    where: { id: req.params.id },
    data: { published: false },
  });
  res.json(page);
});

// Public endpoint — serve published page
router.get('/public/:slug', async (req, res) => {
  const page = await prisma.landingPage.findUnique({ where: { slug: req.params.slug } });
  if (!page || !page.published) return res.status(404).json({ error: 'Page not found' });
  res.json(page);
});

// Public form submission
router.post('/public/:slug/submit', async (req, res) => {
  try {
    const page = await prisma.landingPage.findUnique({ where: { slug: req.params.slug } });
    if (!page) return res.status(404).json({ error: 'Page not found' });

    const { firstName, lastName, email, phone, ...rest } = req.body;
    let contact = null;
    if (email || phone) {
      contact = await prisma.contact.findFirst({
        where: { accountId: page.accountId, OR: [email ? { email } : null, phone ? { phone } : null].filter(Boolean) },
      });
      if (!contact) {
        contact = await prisma.contact.create({
          data: { firstName: firstName || '', lastName: lastName || '', email, phone, source: 'FORM', accountId: page.accountId },
        });
      }
    }

    await prisma.formSubmission.create({
      data: { landingPageId: page.id, contactId: contact?.id, data: req.body },
    });

    res.json({ success: true, contactId: contact?.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
