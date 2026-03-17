
import nodemailer from 'nodemailer';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }

    const { email } = req.body;

    if (!email) {
        return res.status(400).json({ message: 'Email is required' });
    }

    // Configuração do Transporter (Zoho ou outro SMTP)
    const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT),
        secure: Number(process.env.SMTP_PORT) === 465, // true para 465, false para outros
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
        },
    });

    try {
        await transporter.sendMail({
            from: `"FinElo System" <${process.env.SMTP_USER}>`,
            to: 'suporte@finelo.app.br', // Email do admin que vai receber o alerta
            subject: '🚀 Novo Usuário Cadastrado!',
            text: `Um novo usuário acabou de se cadastrar no FinElo!\n\nEmail: ${email}\n\nFique atento para prestar suporte inicial se necessário.`,
            html: `
        <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
          <h2 style="color: #0d9488;">🚀 Novo Usuário Cadastrado!</h2>
          <p>Um novo usuário acabou de se cadastrar na plataforma.</p>
          <p><strong>Email:</strong> ${email}</p>
          <hr style="border: 1px solid #eee; margin: 20px 0;" />
          <p style="font-size: 12px; color: #888;">Este é um alerta automático do sistema FinElo.</p>
        </div>
      `,
        });

        return res.status(200).json({ message: 'Notification sent' });
    } catch (error) {
        console.error('Error sending email:', error);
        return res.status(500).json({ message: 'Error sending notification', error: error.message });
    }
}
