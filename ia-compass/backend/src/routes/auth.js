const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

router.post('/register', async (req, res) => {
  try {
    const { name, agencyName, email, password } = req.body;
    const displayName = name || agencyName;
    if (!displayName || !email || !password) {
      return res.status(400).json({ error: 'name, email and password required' });
    }
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return res.status(400).json({ error: 'Email already in use' });

    const agency = await prisma.agency.create({ data: { name: displayName } });
    const account = await prisma.account.create({ data: { agencyId: agency.id, name: displayName } });
    const hashed = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { email, password: hashed, name: displayName, role: 'AGENCY_ADMIN', agencyId: agency.id, accountId: account.id },
    });

    const token = jwt.sign(
      { userId: user.id, role: user.role, agencyId: agency.id, accountId: account.id },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const token = jwt.sign(
      { userId: user.id, role: user.role, agencyId: user.agencyId, accountId: user.accountId },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
