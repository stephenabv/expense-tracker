/**
 * Transactional email templates.
 *
 * Table-based HTML with inline styles, because that is what mail clients
 * actually render. Each message carries one clear action and nothing sensitive:
 * no password, no account details beyond the address it was sent to, and the
 * token only inside the link.
 */

export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

const BRAND = "Expense Tracker";
const INK = "#0d1117";
const MUTED = "#6b7280";
const BORDER = "#e6e8ec";

function layout(options: {
  heading: string;
  body: string;
  ctaLabel: string;
  ctaUrl: string;
  footnote: string;
}): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${BRAND}</title>
</head>
<body style="margin:0;padding:0;background:#f5f6f8;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f6f8;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
               style="max-width:520px;background:#ffffff;border:1px solid ${BORDER};border-radius:16px;">
          <tr>
            <td style="padding:28px 28px 0 28px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
              <p style="margin:0;font-size:13px;letter-spacing:0.08em;text-transform:uppercase;color:${MUTED};">${BRAND}</p>
              <h1 style="margin:12px 0 0 0;font-size:22px;line-height:1.3;color:${INK};font-weight:600;">${options.heading}</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 28px 0 28px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
              <p style="margin:0;font-size:15px;line-height:1.6;color:${MUTED};">${options.body}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 28px 0 28px;">
              <a href="${options.ctaUrl}"
                 style="display:inline-block;background:${INK};color:#ffffff;text-decoration:none;
                        padding:13px 22px;border-radius:12px;font-size:15px;font-weight:600;
                        font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
                ${options.ctaLabel}
              </a>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 28px 0 28px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
              <p style="margin:0;font-size:13px;line-height:1.6;color:${MUTED};">
                If the button doesn't work, copy this link into your browser:<br />
                <span style="word-break:break-all;color:${INK};">${options.ctaUrl}</span>
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 28px 28px 28px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
              <p style="margin:0;padding-top:16px;border-top:1px solid ${BORDER};font-size:13px;line-height:1.6;color:${MUTED};">
                ${options.footnote}
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function verificationEmail(url: string): EmailContent {
  return {
    subject: `Verify your ${BRAND} email address`,
    html: layout({
      heading: "Verify your email address",
      body: "Confirm this address to activate your account and start tracking your budgets.",
      ctaLabel: "Verify Email",
      ctaUrl: url,
      footnote:
        "This link expires in 24 hours and can be used once. If you didn't create an account, you can ignore this email.",
    }),
    text: [
      `Verify your ${BRAND} email address`,
      "",
      "Confirm this address to activate your account:",
      url,
      "",
      "This link expires in 24 hours and can be used once.",
      "If you didn't create an account, you can ignore this email.",
    ].join("\n"),
  };
}

export function passwordResetEmail(url: string): EmailContent {
  return {
    subject: `Reset your ${BRAND} password`,
    html: layout({
      heading: "Reset your password",
      body: "Choose a new password for your account. Your current password stays active until you finish.",
      ctaLabel: "Reset Password",
      ctaUrl: url,
      footnote:
        "This link expires in 1 hour and can be used once. If you didn't request a reset, you can ignore this email — nothing has changed.",
    }),
    text: [
      `Reset your ${BRAND} password`,
      "",
      "Choose a new password for your account:",
      url,
      "",
      "This link expires in 1 hour and can be used once.",
      "If you didn't request a reset, you can ignore this email.",
    ].join("\n"),
  };
}
