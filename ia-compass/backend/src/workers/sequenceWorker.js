const { Worker } = require('bullmq');
const IORedis = require('ioredis');
const { PrismaClient } = require('@prisma/client');
const { sendSMS } = require('../services/twilio');
const { sendEmail } = require('../services/mailgun');
const { scheduleNextStep } = require('../services/sequenceRunner');

const prisma = new PrismaClient();

function startWorker() {
  const connection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
  });

  const worker = new Worker(
    'sequence-steps',
    async (job) => {
      const { enrollmentId } = job.data;

      const enrollment = await prisma.sequenceEnrollment.findUnique({
        where: { id: enrollmentId },
        include: {
          contact: true,
          sequence: { include: { steps: { orderBy: { order: 'asc' } } } },
        },
      });

      if (!enrollment || enrollment.status !== 'ACTIVE') return;

      const steps = enrollment.sequence.steps;
      const stepIndex = enrollment.currentStep;

      if (stepIndex >= steps.length) {
        await prisma.sequenceEnrollment.update({
          where: { id: enrollmentId },
          data: { status: 'COMPLETED' },
        });
        return;
      }

      const step = steps[stepIndex];
      const contact = enrollment.contact;
      let logStatus = 'SENT';
      let logError = null;

      try {
        if (step.stepType === 'SMS') {
          if (!contact.phone) throw new Error('Contact has no phone number');
          await sendSMS(contact.phone, step.body);
        } else if (step.stepType === 'EMAIL') {
          if (!contact.email) throw new Error('Contact has no email');
          await sendEmail({
            to: contact.email,
            subject: step.subject || '(No subject)',
            html: `<p>${step.body.replace(/\n/g, '<br>')}</p>`,
          });
        }
      } catch (err) {
        logStatus = 'FAILED';
        logError = err.message;
        console.error(`Step ${step.id} failed for enrollment ${enrollmentId}:`, err.message);
      }

      await prisma.sequenceStepLog.create({
        data: { enrollmentId, stepId: step.id, status: logStatus, error: logError },
      });

      const nextStep = stepIndex + 1;
      await prisma.sequenceEnrollment.update({
        where: { id: enrollmentId },
        data: { currentStep: nextStep },
      });

      if (nextStep < steps.length) {
        const nextDelay = steps[nextStep].delayMinutes;
        await scheduleNextStep(enrollmentId, nextDelay);
      } else {
        await prisma.sequenceEnrollment.update({
          where: { id: enrollmentId },
          data: { status: 'COMPLETED' },
        });
      }
    },
    { connection }
  );

  worker.on('failed', (job, err) => {
    console.error(`Job ${job?.id} failed:`, err.message);
  });

  console.log('Sequence worker started');
  return worker;
}

module.exports = { startWorker };
