"""
Email delivery for the Warehouse Sourcing Tool.

Providers (set EMAIL_PROVIDER in .env):
  gmail    — Free. Uses Gmail SMTP + App Password. Default.
  sendgrid — SendGrid API (free tier 100/day).
  ses      — AWS SES.
"""
from __future__ import annotations
import base64
import os
import smtplib
from datetime import date
from email import encoders
from email.mime.base import MIMEBase
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText


# ---------------------------------------------------------------------------
# HTML body builder
# ---------------------------------------------------------------------------

def _build_html_body(scored_df, analyst_name: str = "") -> str:
    actionable = scored_df[scored_df["Score_Category"] == "Actionable"]
    tentative  = scored_df[scored_df["Score_Category"] == "Tentative"]
    passed     = scored_df[scored_df["Score_Category"] == "Pass"]

    def _v(row, *keys):
        for k in keys:
            v = row.get(k)
            if v is not None and str(v).strip() not in ("", "nan", "None", "null"):
                return str(v).strip()
        return None

    def _row_bullet(row) -> str:
        addr    = _v(row, "address") or "Unknown Address"
        sf_raw  = _v(row, "total_sf")
        ht_raw  = _v(row, "clear_height")
        reason  = _v(row, "Scoring_Reason") or ""
        notes   = _v(row, "notes") or ""

        implied = _v(row, "Implied_Purchase_Price")
        asking  = _v(row, "asking_price_psf")
        delta   = _v(row, "Pricing_Delta")
        court   = _v(row, "Truck_Court_Depth")
        power   = _v(row, "Power_Density")

        sf_fmt = f"{float(sf_raw):,.0f} SF" if sf_raw else "N/A"
        ht_fmt = f"{float(ht_raw):.0f}' Clear" if ht_raw else "N/A"

        # Financial line
        fin_line = ""
        if implied:
            implied_fmt = f"${float(implied):.2f}"
            asking_fmt  = f"${float(asking):.2f}" if asking else "N/A"
            delta_fmt   = (f"+${float(delta):.2f}" if float(delta) > 0 else f"${float(delta):.2f}") if delta else "N/A"
            fin_line = (
                f"<br>&nbsp;&nbsp;"
                f"Implied: <strong>{implied_fmt}/SF</strong> | "
                f"Asking: <strong>{asking_fmt}/SF</strong> | "
                f"Delta: <strong>{delta_fmt}</strong>"
            )

        # Physical line
        phys_parts = []
        if power:
            phys_parts.append(f"Power: {power}")
        if court:
            phys_parts.append(f"Court: {court}")
        phys_line = f"<br>&nbsp;&nbsp;{' &nbsp;|&nbsp; '.join(phys_parts)}" if phys_parts else ""

        # Reason (bold first sentence)
        first_reason = reason.split(";")[0].strip() if reason else ""
        reason_line  = f"<br>&nbsp;&nbsp;<em>{first_reason}</em>" if first_reason else ""

        notes_line = f"<br>&nbsp;&nbsp;Notes: {notes}" if notes else ""

        return (
            f"<li style='margin-bottom:12px'>"
            f"<strong>{addr}</strong> – {sf_fmt} | {ht_fmt}"
            f"{fin_line}"
            f"{phys_line}"
            f"{reason_line}"
            f"{notes_line}"
            f"</li>"
        )

    def _section(df, emoji, label, color, bg) -> str:
        if df.empty:
            return (
                f"<h3 style='color:{color};background:{bg};padding:6px 12px;"
                f"border-radius:6px;margin-top:20px'>{emoji} {label} (0)</h3>"
                f"<p style='color:#888;margin-left:12px'>None this period.</p>"
            )
        bullets = "".join(_row_bullet(r) for _, r in df.iterrows())
        return (
            f"<h3 style='color:{color};background:{bg};padding:6px 12px;"
            f"border-radius:6px;margin-top:20px'>{emoji} {label} ({len(df)})</h3>"
            f"<ul style='line-height:1.9;margin-top:8px'>{bullets}</ul>"
        )

    today  = date.today().strftime("%B %d, %Y")
    total  = len(scored_df)
    uploader_line = f"<p><strong>Uploaded by:</strong> {analyst_name}</p>" if analyst_name else ""

    return f"""
<html><body style="font-family:Arial,sans-serif;max-width:680px;margin:auto;color:#222;font-size:14px">

<div style="background:#1F3864;padding:16px 20px;border-radius:8px 8px 0 0">
  <h2 style="color:#fff;margin:0;font-size:18px">🏭 Industrial Warehouse Sourcing Report</h2>
  <p style="color:#adc3e8;margin:4px 0 0">{today}</p>
</div>

<div style="background:#f8f9fb;padding:16px 20px;border:1px solid #dde3ec;border-top:none;border-radius:0 0 8px 8px">
  {uploader_line}
  <p style="margin-top:8px">
    <strong>Total Reviewed:</strong> {total} &nbsp;|&nbsp;
    <strong style="color:#276221">🟢 Actionable: {len(actionable)}</strong> &nbsp;|&nbsp;
    <strong style="color:#9C5700">🟡 Tentative: {len(tentative)}</strong> &nbsp;|&nbsp;
    <strong style="color:#9C0006">🔴 Pass: {len(passed)}</strong>
  </p>
</div>

<div style="margin-top:20px">
  {_section(actionable, "🟢", "Actionable (High Priority)", "#276221", "#C6EFCE")}
  {_section(tentative,  "🟡", "Tentative (Need More Info)",  "#9C5700", "#FFEB9C")}
  {_section(passed,     "🔴", "Pass",                        "#9C0006", "#FFC7CE")}
</div>

<hr style="margin-top:30px;border:none;border-top:1px solid #dde">
<p style="font-size:11px;color:#999;margin-top:8px">
  Financial formula: Implied Price = (Market Rent × 1.35 − $8.00) ÷ 11% − $50.00 (per SF)<br>
  Generated by Easybay Sourcing Tool. Full scored data attached.
</p>
</body></html>
"""


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def send_report(
    scored_df,
    excel_bytes: bytes,
    excel_filename: str,
    recipient_emails: list[str],
    sender_email: str | None = None,
    analyst_name: str = "",
) -> dict:
    provider  = os.getenv("EMAIL_PROVIDER", "gmail").lower()
    sender    = sender_email or os.getenv("EMAIL_FROM", "")
    today     = date.today().strftime("%B %d, %Y")
    subject   = f"Warehouse Sourcing Report — {today}"
    if analyst_name:
        subject += f" ({analyst_name})"
    html_body = _build_html_body(scored_df, analyst_name)

    results = []
    for recipient_email in recipient_emails:
        recipient_email = recipient_email.strip()
        if not recipient_email:
            continue
        if provider == "sendgrid":
            results.append(_send_sendgrid(subject, html_body, sender, recipient_email, excel_bytes, excel_filename))
        elif provider == "ses":
            results.append(_send_ses(subject, html_body, sender, recipient_email, excel_bytes, excel_filename))
        else:
            results.append(_send_gmail(subject, html_body, sender, recipient_email, excel_bytes, excel_filename))

    return {"status": "ok", "sent_to": recipient_emails, "results": results}


# ---------------------------------------------------------------------------
# Gmail SMTP  (free — needs GMAIL_USER + GMAIL_APP_PASSWORD in .env)
# ---------------------------------------------------------------------------

def _send_gmail(subject, html_body, sender, recipient, excel_bytes, excel_filename) -> dict:
    gmail_user = os.getenv("GMAIL_USER") or sender
    app_password = os.getenv("GMAIL_APP_PASSWORD")

    if not gmail_user:
        raise EnvironmentError("Set GMAIL_USER (or EMAIL_FROM) in .env")
    if not app_password:
        raise EnvironmentError(
            "GMAIL_APP_PASSWORD not set. "
            "Create one at myaccount.google.com → Security → App Passwords."
        )

    msg = _build_mime(subject, html_body, gmail_user, recipient, excel_bytes, excel_filename)

    with smtplib.SMTP_SSL("smtp.gmail.com", 465) as server:
        server.login(gmail_user, app_password)
        server.sendmail(gmail_user, recipient, msg.as_bytes())

    return {"status": "ok", "provider": "gmail"}


# ---------------------------------------------------------------------------
# SendGrid
# ---------------------------------------------------------------------------

def _send_sendgrid(subject, html_body, sender, recipient, excel_bytes, excel_filename) -> dict:
    import sendgrid
    from sendgrid.helpers.mail import (
        Mail, Attachment, FileContent, FileName, FileType, Disposition,
    )

    api_key = os.getenv("SENDGRID_API_KEY")
    if not api_key:
        raise EnvironmentError("SENDGRID_API_KEY not set")

    message = Mail(from_email=sender, to_emails=recipient, subject=subject, html_content=html_body)
    message.attachment = Attachment(
        FileContent(base64.b64encode(excel_bytes).decode()),
        FileName(excel_filename),
        FileType("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
        Disposition("attachment"),
    )
    sg = sendgrid.SendGridAPIClient(api_key=api_key)
    response = sg.send(message)
    return {"status": "ok", "provider": "sendgrid", "status_code": response.status_code}


# ---------------------------------------------------------------------------
# AWS SES
# ---------------------------------------------------------------------------

def _send_ses(subject, html_body, sender, recipient, excel_bytes, excel_filename) -> dict:
    import boto3

    msg = _build_mime(subject, html_body, sender, recipient, excel_bytes, excel_filename)
    client = boto3.client("ses", region_name=os.getenv("AWS_REGION", "us-east-1"))
    response = client.send_raw_email(
        Source=sender,
        Destinations=[recipient],
        RawMessage={"Data": msg.as_bytes()},
    )
    return {"status": "ok", "provider": "ses", "message_id": response["MessageId"]}


# ---------------------------------------------------------------------------
# Shared MIME builder
# ---------------------------------------------------------------------------

def _build_mime(subject, html_body, sender, recipient, excel_bytes, excel_filename) -> MIMEMultipart:
    msg = MIMEMultipart("mixed")
    msg["Subject"] = subject
    msg["From"]    = sender
    msg["To"]      = recipient

    body = MIMEMultipart("alternative")
    body.attach(MIMEText(html_body, "html"))
    msg.attach(body)

    part = MIMEBase("application", "vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    part.set_payload(excel_bytes)
    encoders.encode_base64(part)
    part.add_header("Content-Disposition", f'attachment; filename="{excel_filename}"')
    msg.attach(part)
    return msg
