// app/api/contact/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: NextRequest) {
  try {
    const { name, email, message } = await request.json();

    // Basic validation
    if (!name || !email || !message) {
      return NextResponse.json({ error: 'All fields are required' }, { status: 400 });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json({ error: 'Invalid email address' }, { status: 400 });
    }

    // Save to database first
    const { data: savedMessage, error: dbError } = await supabase
      .from('contact_messages')
      .insert([
        {
          name: name.trim(),
          email: email.trim(),
          message: message.trim(),
          created_at: new Date().toISOString(),
          status: 'unread',
          email_sent: false
        }
      ])
      .select()
      .single();

    if (dbError) {
      console.error('Database error:', dbError);
      return NextResponse.json({ error: 'Failed to save message' }, { status: 500 });
    }

    console.log('Message saved to database:', savedMessage.id);

    // Send emails using OAuth2
    let emailSent = false;
    try {
      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          type: 'OAuth2',
          user: process.env.GMAIL_USER,
          clientId: process.env.GMAIL_CLIENT_ID,
          clientSecret: process.env.GMAIL_CLIENT_SECRET,
          refreshToken: process.env.GMAIL_REFRESH_TOKEN,
        },
      });

      // Send confirmation email to user
      await transporter.sendMail({
        from: `"AgentPilot" <${process.env.GMAIL_USER}>`,
        to: email,
        subject: 'Thanks for reaching out to AgentPilot!',
        html: `
          <!DOCTYPE html>
          <html>
            <head>
              <meta charset="utf-8">
              <style>
                body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
                .container { max-width: 600px; margin: 0 auto; }
                .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
                .content { background: white; padding: 30px; border: 1px solid #e1e5e9; border-top: none; border-radius: 0 0 8px 8px; }
                .message-box { background: #f8f9fa; padding: 15px; border-radius: 6px; margin: 20px 0; border-left: 4px solid #667eea; }
              </style>
            </head>
            <body>
              <div class="container">
                <div class="header">
                  <h1>Message Received!</h1>
                  <p>Thanks for reaching out to AgentPilot</p>
                </div>
                <div class="content">
                  <p>Hi <strong>${name}</strong>,</p>
                  
                  <p>We've received your message and we're excited to hear from you!</p>
                  
                  <div class="message-box">
                    <h4>Your message:</h4>
                    <p>"${message.length > 200 ? message.substring(0, 200) + '...' : message}"</p>
                  </div>
                  
                  <p><strong>What happens next?</strong></p>
                  <ul>
                    <li>We'll review your message within 24 hours</li>
                    <li>You'll get a personal response at <strong>${email}</strong></li>
                    <li>We'll help you get started with AgentPilot</li>
                  </ul>
                  
                  <p>In the meantime, feel free to explore AgentPilot and see what AI workflows you can build!</p>
                  
                  <p>Best regards,<br>
                  <strong>The AgentPilot Team</strong></p>
                  
                  <p><a href="https://agentpilot.ai" style="color: #667eea;">agentpilot.ai</a></p>
                </div>
              </div>
            </body>
          </html>
        `,
        text: `
Hi ${name},

We've received your message and we're excited to hear from you!

Your message: "${message}"

What happens next?
- We'll review your message within 24 hours
- You'll get a personal response at ${email}
- We'll help you get started with AgentPilot

Best regards,
The AgentPilot Team
agentpilot.ai
        `,
      });

      // Send notification email to you
      await transporter.sendMail({
        from: `"AgentPilot Contact" <${process.env.GMAIL_USER}>`,
        to: 'hello@agentpilot.ai',
        subject: `New Contact: ${name}`,
        replyTo: email,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px;">
            <h2>New Contact Form Submission</h2>
            <div style="background: #f8f9fa; padding: 20px; border-radius: 8px;">
              <h3>Contact Details</h3>
              <p><strong>Name:</strong> ${name}</p>
              <p><strong>Email:</strong> ${email}</p>
              <p><strong>Date:</strong> ${new Date().toLocaleString()}</p>
              
              <h3>Message</h3>
              <div style="background: white; padding: 15px; border-radius: 6px; border: 1px solid #ddd;">
                ${message.replace(/\n/g, '<br>')}
              </div>
              
              <p><strong>Reply directly to this email to respond to ${name}</strong></p>
            </div>
          </div>
        `,
      });

      emailSent = true;
      console.log('Emails sent successfully');

      await supabase
        .from('contact_messages')
        .update({ email_sent: true })
        .eq('id', savedMessage.id);

    } catch (emailError) {
      console.error('Email sending failed (but message was saved):', emailError);
    }

    return NextResponse.json({ 
      success: true, 
      messageId: savedMessage.id,
      emailSent: emailSent,
      message: emailSent 
        ? `Thanks ${name}! We've received your message and sent you a confirmation email.`
        : `Thanks ${name}! We've received your message and will get back to you soon.`
    });

  } catch (error) {
    console.error('Contact form error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}