import 'dotenv/config';
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

async function sendTestEmail() {
  const { data, error } = await resend.emails.send({
    from: 'onboarding@resend.dev',
    to: 'stanleyokafor08@gmail.com', // must match the email you signed up with
    subject: 'Test OTP Email',
    html: '<p>Your test OTP is <strong>123456</strong></p>',
  });

  if (error) {
    console.error('Error sending email:', error);
  } else {
    console.log('Email sent:', data);
  }
}

sendTestEmail();