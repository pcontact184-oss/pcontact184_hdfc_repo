import json
import os
import pyotp

API_KEY = os.environ.get("API_KEY", "")
OTP_SECRET = os.environ.get("OTP_SECRET", "")  # Base32 secret
OTP_ISSUER = os.environ.get("OTP_ISSUER", "HDFC Security Dashboard")


def resp(status, body):
    return {
        "statusCode": status,
        "headers": {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "*",
            "Access-Control-Allow-Methods": "POST,OPTIONS",
            "Content-Type": "application/json"
        },
        "body": json.dumps(body)
    }


def parse_body(event):
    body = event.get("body")

    if not body:
        return {}

    if event.get("isBase64Encoded"):
        import base64
        body = base64.b64decode(body).decode("utf-8")

    if isinstance(body, dict):
        return body

    return json.loads(body)


def lambda_handler(event, context):
    method = event.get("requestContext", {}).get("http", {}).get("method", "")

    if method == "OPTIONS":
        return resp(200, {})

    headers = {k.lower(): v for k, v in (event.get("headers") or {}).items()}
    if headers.get("x-api-key") != API_KEY:
        return resp(401, {"message": "Unauthorized"})

    if not OTP_SECRET:
        return resp(500, {"message": "OTP secret is not configured on server"})

    try:
        body = parse_body(event)

        email = (body.get("email") or "").strip().lower()
        otp = str(body.get("otp") or "").strip()

        if not email:
            return resp(400, {"message": "Email is required"})

        if not otp or not otp.isdigit() or len(otp) != 6:
            return resp(400, {"message": "Invalid OTP format", "email": email})

        totp = pyotp.TOTP(OTP_SECRET)

        # valid_window=1 allows small clock drift
        if totp.verify(otp, valid_window=1):
            return resp(200, {
                "message": "OTP verified successfully",
                "email": email
            })

        return resp(401, {
            "message": "Invalid OTP",
            "email": email
        })

    except Exception as e:
        return resp(500, {"message": str(e)})
