function tenancyMiddleware(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  if (req.user.role === 'AGENCY_ADMIN') {
    const accountId = req.query.accountId || req.user.accountId;
    if (!accountId) {
      return res.status(400).json({ error: 'accountId required for agency admin' });
    }
    req.accountId = accountId;
  } else {
    if (!req.user.accountId) {
      return res.status(400).json({ error: 'No account associated with user' });
    }
    req.accountId = req.user.accountId;
  }
  next();
}

module.exports = tenancyMiddleware;
