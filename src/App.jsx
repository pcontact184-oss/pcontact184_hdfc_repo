import { useMemo, useState, useEffect } from "react";
import axios from "axios";
import { motion } from "framer-motion";
import { FaRocket } from "react-icons/fa";
import "./App.css";
import VideoBackground from "./VideoBackground";

const RAW_API_BASE = import.meta.env.VITE_API_BASE;
const API_KEY = import.meta.env.VITE_API_KEY;

// Remove trailing slash if present
const API_BASE = RAW_API_BASE?.replace(/\/+$/, "");

if (!API_BASE)
  throw new Error("VITE_API_BASE is missing. Check .env location and restart Vite.");
if (!API_KEY)
  throw new Error("VITE_API_KEY is missing. Check .env location and restart Vite.");

// One axios client so x-api-key always attached
const api = axios.create({
  baseURL: API_BASE,
  timeout: 30000,
  headers: {
    "Content-Type": "application/json",
    "x-api-key": API_KEY,
  },
});

function normalizeCsv(input) {
  return input
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidRegion(region) {
  return /^[a-z]{2}-[a-z]+-\d$/.test(region);
}

async function sesCheck(email) {
  const res = await api.post("/ses/check", { email });
  return res.data;
}

async function otpVerify(email, otp) {
  const res = await api.post("/otp/verify", {
    email,
    otp,
  });
  return res.data;
}

async function reportSend({ days, emailsCsv, regions }) {
  const res = await api.post("/report/send", {
    days: Number(days),
    emails: emailsCsv,
    toEmails: emailsCsv,
    regions,
    all_regions: false,
  });
  return res.data;
}

export default function App() {
  const [emailsRaw, setEmailsRaw] = useState("");
  const [days, setDays] = useState("7");
  const [regionsRaw, setRegionsRaw] = useState("ap-south-1");

  const [emailStatus, setEmailStatus] = useState({
    state: "idle", // idle | loading | ok | bad | error
    details: [], // [{ email, ok, out }]
  });

  const [sendState, setSendState] = useState("idle"); // idle | otp | sending | success
  const [sendError, setSendError] = useState("");

  const [otp, setOtp] = useState("");
  const [otpAttempts, setOtpAttempts] = useState(0);
  const [locked, setLocked] = useState(false);

  const emails = useMemo(() => normalizeCsv(emailsRaw), [emailsRaw]);
  const regions = useMemo(() => normalizeCsv(regionsRaw), [regionsRaw]);

  const emailsValid = emails.length > 0 && emails.every((e) => isValidEmail(e));
  const canValidateEmails = !locked && emailsValid;

  const emailsValidated =
    emailStatus.state === "ok" && emailStatus.details.length === emails.length;

  const daysNum = Number(days);
  const daysValid = Number.isFinite(daysNum) && daysNum > 0 && daysNum <= 90;

  const regionsValid = regions.length > 0 && regions.every((r) => isValidRegion(r));

  const canEnableSend = !locked && emailsValidated && daysValid && regionsValid;

  // First email is auth email for OTP verification
  const authEmail = emails[0] || "";

  // This is what backend receives
  const emailsCsv = emails.join(",");

  const notVerifiedEmails = useMemo(() => {
    if (!emailStatus.details?.length) return [];
    return emailStatus.details.filter((d) => !d.ok).map((d) => d.email);
  }, [emailStatus.details]);

  useEffect(() => {
    // Reset form values on page refresh
    setEmailsRaw("");
    setDays("7");
    setRegionsRaw("ap-south-1");
  }, []);

  async function handleValidateEmails() {
    setSendError("");

    if (!emails.length) {
      setEmailStatus({ state: "error", details: [] });
      setSendError("Enter at least one email.");
      return;
    }

    if (!emailsValid) {
      setEmailStatus({ state: "error", details: [] });
      setSendError("One or more emails are invalid.");
      return;
    }

    setEmailStatus({ state: "loading", details: [] });

    try {
      const results = [];

      for (const e of emails) {
        const out = await sesCheck(e);
        results.push({ email: e, ok: out?.exists === true, out });
      }

      const allOk = results.every((r) => r.ok);

      if (!allOk) {
        setEmailStatus({ state: "bad", details: results });
        return;
      }

      setEmailStatus({ state: "ok", details: results });
    } catch (err) {
      setEmailStatus({ state: "error", details: [] });
      setSendError(
        err?.response?.data?.message ||
          err?.response?.data?.error ||
          err.message ||
          "Email check failed"
      );
    }
  }

  function handleSendClick() {
    setSendError("");
    setSendState("otp");
    setOtp("");
    setOtpAttempts(0);
    setLocked(false);
  }

  async function handleVerifyAndSend() {
    if (locked) return;

    setSendError("");

    if (!canEnableSend) {
      setSendError("Complete SES check + valid days + valid regions first.");
      return;
    }

    if (otpAttempts >= 3) {
      setLocked(true);
      setSendError("Session cancelled: OTP failed 3 times.");
      return;
    }

    if (!/^\d{6}$/.test(otp)) {
      setSendError("Enter a valid 6-digit OTP.");
      return;
    }

    try {
      setSendState("sending");

      // 1) Verify OTP
      await otpVerify(authEmail, otp);

      // 2) Send report
      await reportSend({
        days: daysNum,
        emailsCsv,
        regions,
      });

      setSendState("success");

      // Clear values after success
      setEmailsRaw("");
      setDays("");
      setRegionsRaw("");
      setEmailStatus({ state: "idle", details: [] });
      setSendError("");
      setOtp("");
      setOtpAttempts(0);
      setLocked(false);

      setTimeout(() => setSendState("idle"), 2000);
    } catch (err) {
      const msg =
        err?.response?.data?.message ||
        err?.response?.data?.error ||
        err.message ||
        "Failed";

      const nextAttempts = otpAttempts + 1;
      setOtpAttempts(nextAttempts);

      if (nextAttempts >= 3) {
        setLocked(true);
        setSendError("Session cancelled: OTP failed 3 times.");
      } else {
        setSendError(`OTP failed. Attempts: ${nextAttempts}/3. (${msg})`);
      }

      setSendState("otp");
    }
  }

  function resetAll() {
    setEmailsRaw("");
    setDays("7");
    setRegionsRaw("ap-south-1");
    setEmailStatus({ state: "idle", details: [] });
    setSendState("idle");
    setSendError("");
    setOtp("");
    setOtpAttempts(0);
    setLocked(false);
  }

  return (
    <div className="page">
      <VideoBackground />

      <motion.div
        className="card"
        initial={{ opacity: 0, y: -50 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
      >
        <div className="logo-container">
          <img
            className="logo"
            src="/AutomateX_logo.png"
            alt="AutomateX Logo"
          />
        </div>

        <h2 className="headerText">HDFC - Security Report Dashboard</h2>

        <div className="section">
          <label className="label">1) Emails (comma separated)</label>
          <input
            className="input"
            value={emailsRaw}
            onChange={(e) => setEmailsRaw(e.target.value)}
            placeholder="Enter emails"
            disabled={locked}
          />
          <motion.button
            className="button"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={handleValidateEmails}
            disabled={!canValidateEmails}
          >
            {emailStatus.state === "loading" ? "Checking..." : "Check in SES"}
          </motion.button>

          {emailStatus.state === "ok" && <div className="ok">All emails verified in SES.</div>}
          {emailStatus.state === "bad" && <div className="err">Not verified in SES: {notVerifiedEmails.join(", ")}</div>}
          {emailStatus.state === "error" && <div className="err">SES check failed. {sendError}</div>}
        </div>

        <div className="section">
          <label className="label">2) Days (1 - 90)</label>
          <input
            className="input"
            value={days}
            onChange={(e) => setDays(e.target.value)}
            placeholder="7"
            disabled={!emailsValidated || locked}
          />
          {!daysValid && days !== "" && <div className="err">Days must be between 1 and 90.</div>}
        </div>

        <div className="section">
          <label className="label">3) Regions (comma separated)</label>
          <input
            className="input"
            value={regionsRaw}
            onChange={(e) => setRegionsRaw(e.target.value)}
            placeholder="ap-south-1"
            disabled={!emailsValidated || !daysValid || locked}
          />
          {regionsRaw && !regionsValid && <div className="err">Enter valid AWS regions (ex: ap-south-1).</div>}
        </div>

        <motion.button
          className="rocketButton"
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={handleSendClick}
          disabled={!canEnableSend}
        >
          <FaRocket /> Send Report
        </motion.button>

        <motion.button
          className="clearButton"
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={resetAll}
        >
          CLR
        </motion.button>

        {sendState === "otp" && (
          <div className="otpBox">
            <input
              className="input"
              value={otp}
              onChange={(e) => setOtp(e.target.value.trim())}
              placeholder="6-digit OTP"
              disabled={locked}
            />
            <motion.button
              className="button"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={handleVerifyAndSend}
              disabled={locked}
            >
              Verify OTP & Send
            </motion.button>
            <div>Attempts used: {otpAttempts}/3</div>
          </div>
        )}

        {sendState === "sending" && (
          <motion.div
            className="loader"
            animate={{ rotate: 360 }}
            transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
          />
        )}

        {sendState === "success" && (
          <div className="successCircle">Sent</div>
        )}

        {sendError && <div className="err">{sendError}</div>}
      </motion.div>
    </div>
  );
}