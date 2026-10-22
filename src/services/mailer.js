/** Console mailer by default; real SMTP (e.g. Mailpit) when SMTP_URL is set. */
export async function createMailer({ smtpUrl, from, faults, log }) {
  let transport = null;
  if (smtpUrl) {
    const { default: nodemailer } = await import('nodemailer');
    transport = nodemailer.createTransport(smtpUrl);
  }
  return {
    async send({ to, subject, text }) {
      if (faults.email) throw new Error('mail transport down (fault injected)');
      const safeSubject = String(subject).replace(/[\r\n]+/g, ' ');
      if (transport) {
        await transport.sendMail({ from, to, subject: safeSubject, text });
        log.info('email sent via smtp', { to, subject: safeSubject });
      } else {
        log.info('email (console transport)', { to, subject: safeSubject });
      }
    },
  };
}
