const { Queue } = require('bullmq');
const IORedis = require('ioredis');

let queue;

function getQueue() {
  if (!queue) {
    const connection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
      maxRetriesPerRequest: null,
    });
    queue = new Queue('sequence-steps', { connection });
  }
  return queue;
}

async function enrollContact(enrollmentId) {
  const q = getQueue();
  await q.add('process-step', { enrollmentId }, { delay: 0 });
}

async function scheduleNextStep(enrollmentId, delayMinutes) {
  const q = getQueue();
  await q.add('process-step', { enrollmentId }, { delay: delayMinutes * 60 * 1000 });
}

module.exports = { enrollContact, scheduleNextStep };
