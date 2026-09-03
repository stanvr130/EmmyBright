import { Resend } from 'resend';
import bcrypt from 'bcryptjs';
import prisma from '../config/db.js';

const resend = new Resend(process.env.RESEND_API_KEY);

function generateOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Shared helper — creates + sends an OTP for a given purpose
async function createAndSendOtp(email, purpose, subject, bodyText) {
  const recentOtp = await prisma.otpCode.findFirst({
    where: { email, purpose },
    orderBy: { createdAt: 'desc' },
  });

  if (recentOtp) {
    const secondsSinceLastSend = (Date.now() - recentOtp.createdAt.getTime()) / 1000;
    if (secondsSinceLastSend < 30) {
      const waitTime = Math.ceil(30 - secondsSinceLastSend);
      const err = new Error('cooldown');
      err.retryAfter = waitTime;
      throw err;
    }
  }

  const code = generateOtp();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  await prisma.otpCode.updateMany({
    where: { email, purpose, used: false },
    data: { used: true },
  });

  await prisma.otpCode.create({
    data: { email, code, purpose, expiresAt },
  });

  await resend.emails.send({
    from: 'onboarding@resend.dev',
    to: email,
    subject,
    html: `<p>${bodyText} Your code is <strong>${code}</strong>. It expires in 10 minutes.</p>`,
  });
}

// Shared helper — validates a code for a given purpose
async function checkOtp(email, code, purpose) {
  const otpRecord = await prisma.otpCode.findFirst({
    where: { email, purpose, used: false },
    orderBy: { createdAt: 'desc' },
  });

  if (!otpRecord) return { ok: false, error: 'No pending code for this email' };
  if (otpRecord.expiresAt < new Date()) return { ok: false, error: 'Code has expired' };
  if (otpRecord.attempts >= 5) return { ok: false, error: 'Too many attempts. Request a new code.' };

  if (otpRecord.code !== code) {
    await prisma.otpCode.update({
      where: { id: otpRecord.id },
      data: { attempts: { increment: 1 } },
    });
    return { ok: false, error: 'Invalid code' };
  }

  await prisma.otpCode.update({ where: { id: otpRecord.id }, data: { used: true } });
  return { ok: true };
}

// POST /api/auth/send-otp  (registration/email verification — unchanged behavior)
export async function sendOtp(req, res) {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required' });

  try {
    await createAndSendOtp(email, 'verify', 'Your verification code', 'Verify your email —');
    return res.status(200).json({ message: 'OTP sent' });
  } catch (err) {
    if (err.message === 'cooldown') {
      return res.status(429).json({
        error: `Please wait ${err.retryAfter} seconds before requesting another code.`,
        retryAfter: err.retryAfter,
      });
    }
    console.error(err);
    return res.status(500).json({ error: 'Failed to send OTP' });
  }
}

// POST /api/auth/verify-otp  (unchanged behavior, now scoped to purpose: 'verify')
export async function verifyOtp(req, res) {
  const { email, code } = req.body;
  if (!email || !code) return res.status(400).json({ error: 'Email and code are required' });

  try {
    const result = await checkOtp(email, code, 'verify');
    if (!result.ok) return res.status(400).json({ error: result.error });

    await prisma.user.update({ where: { email }, data: { emailVerified: true } });
    return res.status(200).json({ message: 'Email verified successfully' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to verify OTP' });
  }
}

// POST /api/auth/forgot-password
export async function forgotPassword(req, res) {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required' });

  try {
    const user = await prisma.user.findUnique({ where: { email } });

    // Only send if the user exists — but respond the same either way,
    // so we don't leak which emails are registered
    if (user) {
      await createAndSendOtp(email, 'reset', 'Reset your password', 'Reset your password —');
    }

    return res.status(200).json({ message: 'If that email exists, a code has been sent.' });
  } catch (err) {
    if (err.message === 'cooldown') {
      return res.status(429).json({
        error: `Please wait ${err.retryAfter} seconds before requesting another code.`,
        retryAfter: err.retryAfter,
      });
    }
    console.error(err);
    return res.status(500).json({ error: 'Failed to process request' });
  }
}

// POST /api/auth/reset-password
export async function resetPassword(req, res) {
  const { email, code, newPassword } = req.body;
  if (!email || !code || !newPassword) {
    return res.status(400).json({ error: 'Email, code, and new password are required' });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  try {
    const result = await checkOtp(email, code, 'reset');
    if (!result.ok) return res.status(400).json({ error: result.error });

    const hashed = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({ where: { email }, data: { password: hashed } });

    return res.status(200).json({ message: 'Password reset successfully' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to reset password' });
  }
}