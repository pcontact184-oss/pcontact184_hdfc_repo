import json
import os

API_KEY = os.environ.get("API_KEY", "")

def resp(status, body):
    return {
        "statusCode": status,
        "headers": {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "*",
            "Access-Control-Allow-Methods": "POST,OPTIONS"
        },
        "body": json.dumps(body)
    }

def lambda_handler(event, context):
    method = event.get("requestContext", {}).get("http", {}).get("method", "")
    if method == "OPTIONS":
        return resp(200, {})

    headers = {k.lower(): v for k, v in (event.get("headers") or {}).items()}
    if headers.get("x-api-key") != API_KEY:
        return resp(401, {"message": "Unauthorized"})

    try:
        body = json.loads(event.get("body") or "{}")
        email = (body.get("email") or "").strip().lower()
        exists = email in [e.strip().lower() for e in os.environ.get("SCHEDULE_EMAILS", "").split(",") if e.strip()]
        return resp(200, {"email": email, "exists": exists})
    except Exception as e:
        return resp(500, {"message": str(e)})
